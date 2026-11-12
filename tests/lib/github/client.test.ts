// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  fetchRepoTree,
  getBranchHeadSha,
  getInstallationRepo,
  listInstallationRepos,
} from "@/lib/github/client";
import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import { createInstallationToken } from "@/lib/github/installation-token";

let privateKeyPem = "";

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
}, 30_000);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repo(n: number) {
  return { id: n, full_name: `octo/repo-${n}`, default_branch: "main", private: n % 2 === 0 };
}

describe("createInstallationToken", () => {
  it("posts to the access_tokens endpoint with an App JWT and validates the response", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ token: "ghs_abc", expires_at: "2026-11-10T12:00:00Z", permissions: {} }),
    );
    const result = await createInstallationToken({
      appId: "42",
      privateKeyPem,
      installationId: 9001,
      fetch: fetchMock,
    });
    expect(result).toEqual({ token: "ghs_abc", expiresAt: "2026-11-10T12:00:00Z" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/app/installations/9001/access_tokens");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(headers.accept).toBe("application/vnd.github+json");
  });

  it("rejects a payload without a token (Zod) and never exposes the body", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({ expires_at: "2026-11-10T12:00:00Z" });
    await expect(
      createInstallationToken({ appId: "42", privateKeyPem, installationId: 1, fetch: fetchMock }),
    ).rejects.toBeInstanceOf(GitHubResponseError);
  });

  it("maps a non-2xx status to GitHubApiError with the status only", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({ message: "Bad credentials ghs_leak" }, 401);
    let caught: unknown;
    try {
      await createInstallationToken({ appId: "42", privateKeyPem, installationId: 1, fetch: fetchMock });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    const err = caught as GitHubApiError;
    expect(err.status).toBe(401);
    expect(err.operation).toBe("installation token");
    expect(err.message).not.toContain("ghs_leak");
  });
});

describe("listInstallationRepos", () => {
  it("maps repositories to Repo DTOs and pages with hasMore", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const items = page === 1 ? Array.from({ length: 100 }, (_, i) => repo(i + 1)) : [repo(101)];
      return jsonResponse({ total_count: 101, repositories: items });
    });
    const client = { token: "ghs_x", fetch: fetchMock };

    const first = await listInstallationRepos(client, 1);
    expect(first.page).toBe(1);
    expect(first.hasMore).toBe(true);
    expect(first.repos).toHaveLength(100);
    expect(first.repos[0]).toEqual({ fullName: "octo/repo-1", defaultBranch: "main", private: false });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/installation/repositories?per_page=100&page=1",
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghs_x");

    const second = await listInstallationRepos(client, 2);
    expect(second).toEqual({
      repos: [{ fullName: "octo/repo-101", defaultBranch: "main", private: false }],
      page: 2,
      hasMore: false,
    });
  });

  it("rejects a malformed payload with GitHubResponseError", async () => {
    const client = {
      token: "t",
      fetch: (async () => jsonResponse({ repositories: [{ full_name: "x" }] })) as FetchLike,
    };
    await expect(listInstallationRepos(client, 1)).rejects.toBeInstanceOf(GitHubResponseError);
  });

  it("surfaces GitHub errors with status", async () => {
    const client = { token: "t", fetch: (async () => jsonResponse({}, 403)) as FetchLike };
    await expect(listInstallationRepos(client, 1)).rejects.toMatchObject({ status: 403 });
  });
});

describe("getInstallationRepo", () => {
  it("returns the repo with one call to GET /repos/:owner/:repo", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(repo(7)));
    expect(await getInstallationRepo({ token: "t", fetch: fetchMock }, "octo/repo-7")).toEqual({
      fullName: "octo/repo-7",
      defaultBranch: "main",
      private: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/octo/repo-7");
  });

  it("returns null on 404 (not accessible to the installation)", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({ message: "Not Found" }, 404);
    expect(await getInstallationRepo({ token: "t", fetch: fetchMock }, "octo/other")).toBeNull();
  });

  it("rethrows other GitHub errors and rejects bad payloads", async () => {
    const forbidden: FetchLike = async () => jsonResponse({}, 403);
    await expect(getInstallationRepo({ token: "t", fetch: forbidden }, "octo/x")).rejects.toMatchObject({
      status: 403,
    });
    const bad: FetchLike = async () => jsonResponse({ full_name: "octo/x" });
    await expect(getInstallationRepo({ token: "t", fetch: bad }, "octo/x")).rejects.toBeInstanceOf(
      GitHubResponseError,
    );
  });
});

describe("fetchRepoTree and getBranchHeadSha", () => {
  it("returns blob paths only, never contents", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        sha: "abc",
        truncated: false,
        tree: [
          { path: "src", type: "tree", sha: "1", mode: "040000" },
          { path: "src/index.ts", type: "blob", sha: "2", size: 10, mode: "100644" },
          { path: ".env", type: "blob", sha: "3", size: 5, mode: "100644" },
          { path: "vendor", type: "commit", sha: "4", mode: "160000" },
        ],
      }),
    );
    const tree = await fetchRepoTree({ token: "t", fetch: fetchMock }, "octo/repo", "main");
    expect(tree).toEqual({ sha: "abc", paths: ["src/index.ts", ".env"], truncated: false });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/octo/repo/git/trees/main?recursive=1",
    );
  });

  it("validates the branch payload", async () => {
    const good: FetchLike = async () =>
      jsonResponse({ name: "main", commit: { sha: "a".repeat(40), url: "x" } });
    expect(await getBranchHeadSha({ token: "t", fetch: good }, "octo/repo", "main")).toBe("a".repeat(40));
    const bad: FetchLike = async () => jsonResponse({ name: "main", commit: { sha: "short" } });
    await expect(getBranchHeadSha({ token: "t", fetch: bad }, "octo/repo", "main")).rejects.toBeInstanceOf(
      GitHubResponseError,
    );
  });

  it("refuses a malformed repository name before any request", async () => {
    const fetchMock = vi.fn<FetchLike>();
    await expect(fetchRepoTree({ token: "t", fetch: fetchMock }, "no-slash", "main")).rejects.toBeInstanceOf(
      GitHubApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
