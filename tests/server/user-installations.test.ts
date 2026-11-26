// @vitest-environment node
/** D-20: list every installation of the App the user can access. */
import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import { listUserInstallationRepos, listUserInstallations } from "@/server/github/user-auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const item = (id: number, type = "Organization") => ({ id, account: { id: id + 100000, login: `acct-${id}`, type } });

describe("listUserInstallations", () => {
  it("collects every page until total_count is reached", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const items = page === 1 ? Array.from({ length: 100 }, (_, i) => item(i + 1)) : [item(101)];
      return jsonResponse({ total_count: 101, installations: items });
    });
    const list = await listUserInstallations({ userToken: "ghu", fetch: fetchMock });
    expect(list.installations).toHaveLength(101);
    expect(list.installations[100]).toEqual({
      installationId: 101,
      accountLogin: "acct-101",
      accountType: "Organization",
      accountId: 100101,
    });
    expect(list.skipped).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghu");
  });

  it("stops at 10 pages", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return jsonResponse({
        total_count: 5000,
        installations: Array.from({ length: 100 }, (_, i) => item(page * 1000 + i)),
      });
    });
    await listUserInstallations({ userToken: "ghu", fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("empty list → []", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({ total_count: 0, installations: [] });
    expect(await listUserInstallations({ userToken: "ghu", fetch: fetchMock })).toEqual({ installations: [], skipped: 0 });
  });

  it("parses each item on its own: malformed, null-account and enterprise-without-login items are skipped and counted (Phase 1.2)", async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse({
        total_count: 6,
        installations: [
          item(1, "User"),
          { id: 2, account: null },
          { id: 3, account: { id: 9, slug: "ent", type: "Enterprise" } },
          { id: "x", account: { id: 1, login: "a", type: "User" } },
          "garbage",
          item(6, "Bot"),
        ],
      });
    const list = await listUserInstallations({ userToken: "ghu", fetch: fetchMock });
    // Listing does not filter by linkability; Bot is returned with its type.
    expect(list.installations.map((entry) => [entry.installationId, entry.accountType])).toEqual([
      [1, "User"],
      [6, "Bot"],
    ]);
    expect(list.skipped).toBe(4);
  });

  it("rejects HTTP errors and malformed payloads", async () => {
    await expect(
      listUserInstallations({ userToken: "ghu", fetch: async () => jsonResponse({}, 401) }),
    ).rejects.toBeInstanceOf(GitHubApiError);
    await expect(
      listUserInstallations({ userToken: "ghu", fetch: async () => jsonResponse({ installations: "x" }) }),
    ).rejects.toBeInstanceOf(GitHubResponseError);
  });
});

describe("listUserInstallationRepos (R11-12)", () => {
  const repo = (id: number, fullName = `acme/repo-${id}`) => ({
    id,
    full_name: fullName,
    private: false,
    default_branch: "main",
  });

  it("drops and counts a malformed item and keeps the valid ones", async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse({
        total_count: 4,
        repositories: [repo(1), { id: "x", full_name: 5 }, repo(2), repo(3, "bad/../name")],
      });
    const list = await listUserInstallationRepos("ghu", 7, fetchMock);
    expect(list.repos.map((r) => r.id)).toEqual([1, 2]);
    expect(list.dropped).toBe(2);
  });

  it("structural errors still fail the link", async () => {
    await expect(
      listUserInstallationRepos("ghu", 7, async () => jsonResponse({ repositories: [] })),
    ).rejects.toBeInstanceOf(GitHubResponseError);
    await expect(
      listUserInstallationRepos("ghu", 7, async () => jsonResponse({ total_count: 1, repositories: {} })),
    ).rejects.toBeInstanceOf(GitHubResponseError);
  });
});
