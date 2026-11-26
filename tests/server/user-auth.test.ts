// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import {
  exchangeCodeForUserToken,
  isLinkableInstallation,
  resolveUserAccess,
} from "@/server/github/user-auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("exchangeCodeForUserToken", () => {
  it("posts client id, secret and code and returns the token", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ access_token: "ghu_token", token_type: "bearer", scope: "" }),
    );
    const token = await exchangeCodeForUserToken({
      clientId: "Iv1.id",
      clientSecret: "shh",
      code: "code123",
      fetch: fetchMock,
    });
    expect(token).toBe("ghu_token");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "Iv1.id",
      client_secret: "shh",
      code: "code123",
    });
    expect((init?.headers as Record<string, string>).accept).toBe("application/json");
  });

  it("rejects GitHub's 200 { error } answer for a bad code (Zod)", async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse({ error: "bad_verification_code", error_description: "..." });
    await expect(
      exchangeCodeForUserToken({ clientId: "a", clientSecret: "b", code: "c", fetch: fetchMock }),
    ).rejects.toBeInstanceOf(GitHubResponseError);
  });

  it("maps a non-2xx status to GitHubApiError", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({}, 500);
    await expect(
      exchangeCodeForUserToken({ clientId: "a", clientSecret: "b", code: "c", fetch: fetchMock }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});

describe("isLinkableInstallation (D-43)", () => {
  const ME = 1;
  it("own personal account (type User, same id) is linkable", () => {
    expect(isLinkableInstallation({ id: ME, type: "User" }, ME)).toBe(true);
  });
  it("another person's personal account is not linkable", () => {
    expect(isLinkableInstallation({ id: 2, type: "User" }, ME)).toBe(false);
  });
  it("a User whose login equals mine but whose id differs is not linkable (ids only)", () => {
    const account = { id: 3, type: "User", login: "octocat" };
    expect(isLinkableInstallation(account, ME)).toBe(false);
  });
  it("an Organization is linkable", () => {
    expect(isLinkableInstallation({ id: 500, type: "Organization" }, ME)).toBe(true);
  });
  it("Enterprise, Bot, empty, unknown types and a null account are not linkable", () => {
    for (const type of ["Enterprise", "Bot", "", "organization", "user", "Team"]) {
      expect(isLinkableInstallation({ id: ME, type }, ME)).toBe(false);
    }
    expect(isLinkableInstallation(null, ME)).toBe(false);
  });
});

describe("resolveUserAccess (D-43 filter before any repo listing)", () => {
  const USER_TOKEN = "ghu_one_time_token";
  const OWN = 11;
  const OTHER = 22;
  const ORG = 33;
  const ENTERPRISE = 44;

  function world() {
    const urls: string[] = [];
    const fetchMock = vi.fn<FetchLike>(async (input) => {
      const url = new URL(String(input));
      urls.push(url.pathname);
      if (url.pathname === "/login/oauth/access_token") {
        return jsonResponse({ access_token: USER_TOKEN, token_type: "bearer" });
      }
      if (url.pathname === "/user") return jsonResponse({ id: 1, login: "me" });
      if (url.pathname === "/user/installations") {
        return jsonResponse({
          total_count: 5,
          installations: [
            { id: OWN, account: { id: 1, login: "me", type: "User" }, app_id: 9 },
            { id: OTHER, account: { id: 2, login: "owner-person", type: "User" }, app_id: 9 },
            { id: ORG, account: { id: 500, login: "acme", type: "Organization" }, app_id: 9 },
            { id: ENTERPRISE, account: { id: 600, slug: "big-ent", type: "Enterprise" } },
            { id: "not-a-number", account: "nope" },
          ],
        });
      }
      const match = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
      if (match !== null) {
        const id = Number(match[1]);
        return jsonResponse({
          total_count: 1,
          repositories: [{ id: id * 10, full_name: `acct-${id}/repo`, private: true, default_branch: "main" }],
        });
      }
      throw new Error(`unexpected call ${url.pathname}`);
    });
    return { fetchMock, urls };
  }

  it("keeps own + org, skips another person's personal, enterprise and malformed items, never lists their repos", async () => {
    const { fetchMock, urls } = world();
    const result = await resolveUserAccess({ clientId: "a", clientSecret: "b", code: "c", fetch: fetchMock });
    expect(result.user).toEqual({ id: 1, login: "me" });
    expect(result.installations).toEqual([
      {
        installationId: OWN,
        accountLogin: "me",
        accountType: "User",
        accountId: 1,
        repos: [{ id: OWN * 10, fullName: `acct-${OWN}/repo`, private: true, defaultBranch: "main" }],
      },
      {
        installationId: ORG,
        accountLogin: "acme",
        accountType: "Organization",
        accountId: 500,
        repos: [{ id: ORG * 10, fullName: `acct-${ORG}/repo`, private: true, defaultBranch: "main" }],
      },
    ]);
    expect(result.skippedInstallations).toBe(3);
    expect(urls).toEqual([
      "/login/oauth/access_token",
      "/user",
      "/user/installations",
      `/user/installations/${OWN}/repositories`,
      `/user/installations/${ORG}/repositories`,
    ]);
    expect(urls).not.toContain(`/user/installations/${OTHER}/repositories`);
    expect(urls).not.toContain(`/user/installations/${ENTERPRISE}/repositories`);
    // The one-time token is never part of the result.
    expect(JSON.stringify(result)).not.toContain(USER_TOKEN);
  });

  it("a list holding only another person's personal installation yields nothing and no repo call", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn<FetchLike>(async (input) => {
      const url = new URL(String(input));
      urls.push(url.pathname);
      if (url.pathname === "/login/oauth/access_token") {
        return jsonResponse({ access_token: USER_TOKEN, token_type: "bearer" });
      }
      if (url.pathname === "/user") return jsonResponse({ id: 1, login: "me" });
      if (url.pathname === "/user/installations") {
        return jsonResponse({
          total_count: 1,
          installations: [{ id: OTHER, account: { id: 2, login: "me", type: "User" } }],
        });
      }
      throw new Error(`unexpected call ${url.pathname}`);
    });
    const result = await resolveUserAccess({ clientId: "a", clientSecret: "b", code: "c", fetch: fetchMock });
    expect(result.installations).toEqual([]);
    expect(result.skippedInstallations).toBe(1);
    expect(urls.some((path) => path.endsWith("/repositories"))).toBe(false);
  });
});
