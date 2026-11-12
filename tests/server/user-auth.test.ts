// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import {
  exchangeCodeForUserToken,
  findUserInstallation,
  verifyInstallationOwnership,
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

describe("findUserInstallation", () => {
  const installations = (ids: number[]) =>
    ids.map((id) => ({ id, account: { login: `acct-${id}`, type: "Organization" }, app_id: 1 }));

  it("returns the account login when the installation is listed", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ total_count: 2, installations: installations([5, 77]) }),
    );
    expect(await findUserInstallation({ userToken: "ghu", installationId: 77, fetch: fetchMock })).toEqual({
      accountLogin: "acct-77",
    });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghu");
  });

  it("returns null when the installation belongs to someone else", async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse({ total_count: 1, installations: installations([5]) });
    expect(await findUserInstallation({ userToken: "ghu", installationId: 77, fetch: fetchMock })).toBeNull();
  });

  it("pages through results and stops at total_count", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const ids = page === 1 ? Array.from({ length: 100 }, (_, i) => i + 1) : [500];
      return jsonResponse({ total_count: 101, installations: installations(ids) });
    });
    expect(await findUserInstallation({ userToken: "ghu", installationId: 500, fetch: fetchMock })).toEqual({
      accountLogin: "acct-500",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await findUserInstallation({ userToken: "ghu", installationId: 999, fetch: fetchMock })).toBeNull();
  });

  it("rejects an unexpected payload", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({ installations: "nope" });
    await expect(
      findUserInstallation({ userToken: "ghu", installationId: 1, fetch: fetchMock }),
    ).rejects.toBeInstanceOf(GitHubResponseError);
  });
});

describe("verifyInstallationOwnership", () => {
  it("chains the exchange and the installations check", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return jsonResponse({ access_token: "ghu_x", token_type: "bearer" });
      }
      return jsonResponse({ total_count: 1, installations: [{ id: 42, account: { login: "octo" } }] });
    });
    expect(
      await verifyInstallationOwnership({
        clientId: "a",
        clientSecret: "b",
        code: "c",
        installationId: 42,
        fetch: fetchMock,
      }),
    ).toEqual({ accountLogin: "octo" });
    expect(
      await verifyInstallationOwnership({
        clientId: "a",
        clientSecret: "b",
        code: "c",
        installationId: 43,
        fetch: fetchMock,
      }),
    ).toBeNull();
  });
});
