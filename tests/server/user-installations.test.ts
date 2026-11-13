// @vitest-environment node
/** D-20: list every installation of the App the user can access. */
import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import { listUserInstallations } from "@/server/github/user-auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const item = (id: number) => ({ id, account: { login: `acct-${id}` } });

describe("listUserInstallations", () => {
  it("collects every page until total_count is reached", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const items = page === 1 ? Array.from({ length: 100 }, (_, i) => item(i + 1)) : [item(101)];
      return jsonResponse({ total_count: 101, installations: items });
    });
    const list = await listUserInstallations({ userToken: "ghu", fetch: fetchMock });
    expect(list).toHaveLength(101);
    expect(list[100]).toEqual({ installationId: 101, accountLogin: "acct-101" });
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
    expect(await listUserInstallations({ userToken: "ghu", fetch: fetchMock })).toEqual([]);
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
