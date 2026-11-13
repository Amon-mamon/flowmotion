// @vitest-environment node
/**
 * Phase 1.1 branch support: branchNameSchema (git check-ref-format rules),
 * per-segment encoding in GitHub API paths, branch listing and lookup.
 */
import { describe, expect, it, vi } from "vitest";

import { BRANCHES_PER_PAGE, getBranch, getBranchHeadSha, listRepoBranches } from "@/lib/github/client";
import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { FetchLike } from "@/lib/github/http";
import { branchNameSchema, encodeBranchPath, isValidBranchName } from "@/schemas/github";
import { createProjectBodySchema } from "@/schemas/project";

const SHA = "c".repeat(40);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("branchNameSchema", () => {
  const valid = ["main", "feature/x", "release-1.2", "user@x", "a".repeat(255), "v1.0/hotfix", "UPPER_case"];
  const invalid = [
    "",
    "a".repeat(256),
    "@",
    "-x",
    "/x",
    "x/",
    "a..b",
    "a//b",
    "x.lock",
    "a/b.lock/c",
    "a/.b",
    ".hidden",
    "x.",
    "a b",
    " main",
    "main ",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "a@{b",
    "a\u0000b",
    "a\u0007b",
    "a\u007fb",
    "a\nb",
  ];

  it.each(valid)("accepts %j", (name) => {
    expect(branchNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(invalid)("rejects %j", (name) => {
    expect(isValidBranchName(name)).toBe(false);
    expect(branchNameSchema.safeParse(name).success).toBe(false);
  });

  it("rejects names over 255 UTF-8 bytes even when under 255 characters", () => {
    expect(isValidBranchName("é".repeat(128))).toBe(false);
    expect(isValidBranchName("é".repeat(127))).toBe(true);
  });

  it("CreateProjectBody requires branch", () => {
    const base = { repoFullName: "octo/site", installationId: "11111111-1111-4111-8111-111111111111" };
    expect(createProjectBodySchema.safeParse(base).success).toBe(false);
    expect(createProjectBodySchema.safeParse({ ...base, branch: "feature/x" }).success).toBe(true);
    expect(createProjectBodySchema.safeParse({ ...base, branch: "a..b" }).success).toBe(false);
  });
});

describe("encodeBranchPath", () => {
  it("keeps / as a literal separator and encodes each segment", () => {
    expect(encodeBranchPath("feature/x")).toBe("feature/x");
    expect(encodeBranchPath("main")).toBe("main");
    expect(encodeBranchPath("fix/#12 bug")).toBe("fix/%2312%20bug");
    expect(encodeBranchPath("a%b/c")).toBe("a%25b/c");
  });
});

describe("GitHub branch calls use per-segment encoding", () => {
  it("getBranchHeadSha requests /branches/feature/x (not %2F)", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ name: "feature/x", commit: { sha: SHA } }));
    expect(await getBranchHeadSha({ token: "t", fetch: fetchMock }, "octo/site", "feature/x")).toBe(SHA);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/repos/octo/site/branches/feature/x");
    expect(url).not.toContain("%2F");
  });

  it("getBranch returns GitHub's name and head sha", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ name: "Feature/X", commit: { sha: SHA } }));
    expect(await getBranch({ token: "t", fetch: fetchMock }, "octo/site", "feature/x")).toEqual({
      name: "Feature/X",
      headSha: SHA,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/octo/site/branches/feature/x");
  });

  it("getBranch → null on 404, throws on other statuses", async () => {
    const notFound: FetchLike = async () => jsonResponse({ message: "Branch not found" }, 404);
    expect(await getBranch({ token: "t", fetch: notFound }, "octo/site", "gone")).toBeNull();
    const forbidden: FetchLike = async () => jsonResponse({}, 403);
    await expect(getBranch({ token: "t", fetch: forbidden }, "octo/site", "main")).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });

  it("getBranch rejects a malformed GitHub payload", async () => {
    const bad: FetchLike = async () => jsonResponse({ name: "main", commit: { sha: "nope" } });
    await expect(getBranch({ token: "t", fetch: bad }, "octo/site", "main")).rejects.toBeInstanceOf(
      GitHubResponseError,
    );
  });
});

describe("listRepoBranches", () => {
  it("lists { name, protected } in GitHub's order, ignoring extra fields, with paging", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse(
        [
          { name: "main", protected: true, commit: { sha: SHA, url: "x" } },
          { name: "feature/x", protected: false, commit: { sha: SHA, url: "x" } },
        ],
        200,
        { link: '<https://api.github.com/repositories/1/branches?page=3>; rel="next"' },
      ),
    );
    const result = await listRepoBranches({ token: "t", fetch: fetchMock }, "octo/site", 2);
    expect(result).toEqual({
      branches: [
        { name: "main", protected: true },
        { name: "feature/x", protected: false },
      ],
      hasMore: true,
      skipped: 0,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.github.com/repos/octo/site/branches?per_page=${BRANCHES_PER_PAGE}&page=2`,
    );
  });

  it("hasMore is false on a last page (Link without next)", async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse([{ name: "main", protected: false }], 200, {
        link: '<https://api.github.com/repositories/1/branches?page=1>; rel="prev"',
      });
    expect((await listRepoBranches({ token: "t", fetch: fetchMock }, "octo/site", 2)).hasMore).toBe(false);
  });

  it("without a Link header a full page means hasMore", async () => {
    const full = Array.from({ length: BRANCHES_PER_PAGE }, (_, i) => ({ name: `b${i}`, protected: false }));
    const fetchMock: FetchLike = async () => jsonResponse(full);
    expect((await listRepoBranches({ token: "t", fetch: fetchMock }, "octo/site", 1)).hasMore).toBe(true);
    const partial: FetchLike = async () => jsonResponse(full.slice(0, 3));
    expect((await listRepoBranches({ token: "t", fetch: partial }, "octo/site", 1)).hasMore).toBe(false);
  });

  it("a structurally malformed item fails the page (GitHubResponseError)", async () => {
    const fetchMock: FetchLike = async () => jsonResponse([{ name: "main" }]);
    await expect(listRepoBranches({ token: "t", fetch: fetchMock }, "octo/site", 1)).rejects.toBeInstanceOf(
      GitHubResponseError,
    );
    const notArray: FetchLike = async () => jsonResponse({ name: "main", protected: false });
    await expect(listRepoBranches({ token: "t", fetch: notArray }, "octo/site", 1)).rejects.toBeInstanceOf(
      GitHubResponseError,
    );
  });

  it("R11-6: a name our rules reject is skipped and counted, the rest of the page survives", async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse([
        { name: "a..b", protected: false },
        { name: "main", protected: true },
        { name: "x".repeat(300), protected: false },
      ]);
    expect(await listRepoBranches({ token: "t", fetch: fetchMock }, "octo/site", 1)).toEqual({
      branches: [{ name: "main", protected: true }],
      hasMore: false,
      skipped: 2,
    });
  });

  it("GitHub errors carry the status", async () => {
    const fetchMock: FetchLike = async () => jsonResponse({}, 404);
    await expect(listRepoBranches({ token: "t", fetch: fetchMock }, "octo/site", 1)).rejects.toMatchObject({
      status: 404,
    });
  });
});
