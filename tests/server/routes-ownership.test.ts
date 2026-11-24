// @vitest-environment node
/**
 * Route-level ownership (IDOR) and CSRF Origin tests (review R1-3).
 * The real `@/server/auth` and `@/server/http` run; Supabase's session client
 * is faked so `requireUser` and `requireSameOrigin` execute for real. Data
 * access modules are mocked to model "row not owned by this user".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/server/http";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const FOREIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";

const fake = await vi.hoisted(async () => await import("./helpers/fake-supabase"));
const db = vi.hoisted(() => ({ current: null as null | import("./helpers/fake-supabase").FakeDb }));

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  getInstallationForUser: vi.fn(),
  deleteInstallationForUser: vi.fn(),
  listInstallationsForUser: vi.fn(async () => []),
  createProject: vi.fn(),
  deleteProjectForUser: vi.fn(),
  getProjectForUser: vi.fn(),
  listProjectsForUser: vi.fn(async () => []),
  listAnalysisSummaries: vi.fn(async () => []),
  mint: vi.fn(async () => ({ token: "ghs_test", expiresAt: "2026-11-12T00:00:00Z" })),
  repoInstallationId: vi.fn<(fullName: string) => Promise<number | null>>(),
  getInstallationRepo: vi.fn(),
  listInstallationRepos: vi.fn(),
  getBranch: vi.fn(),
  listRepoBranches: vi.fn(),
  audit: vi.fn(async () => undefined),
  updateDisplayName: vi.fn(),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ APP_URL: "https://app.example.com" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: m.getUser, signOut: m.signOut },
    from: (table: string) => {
      if (db.current === null) throw new Error("fake db not ready");
      return fake.fakeFrom(db.current)(table);
    },
  }),
}));
vi.mock("@/server/rate-limit", () => ({
  RATE_LIMITS: { api: 120, heavy: 10, auth: 20, webhook: 60 },
  enforceIpLimit: vi.fn(async () => undefined),
  enforceUserLimit: vi.fn(async () => undefined),
}));
vi.mock("@/server/audit", () => ({ audit: m.audit }));
vi.mock("@/server/installations", () => ({
  getInstallationForUser: m.getInstallationForUser,
  deleteInstallationForUser: m.deleteInstallationForUser,
  listInstallationsForUser: m.listInstallationsForUser,
}));
vi.mock("@/server/projects", () => ({
  createProject: m.createProject,
  deleteProjectForUser: m.deleteProjectForUser,
  getProjectForUser: m.getProjectForUser,
  listProjectsForUser: m.listProjectsForUser,
  listAnalysisSummaries: m.listAnalysisSummaries,
  countRecommendationsByAnalysis: vi.fn(async () => new Map()),
}));
vi.mock("@/server/profile", () => ({
  getProfile: vi.fn(),
  updateDisplayName: m.updateDisplayName,
}));
vi.mock("@/server/github/app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/github/app")>()),
  mintInstallationToken: m.mint,
  repoInstallationId: m.repoInstallationId,
}));
vi.mock("@/lib/github/client", () => ({
  getInstallationRepo: m.getInstallationRepo,
  listInstallationRepos: m.listInstallationRepos,
  getBranch: m.getBranch,
  listRepoBranches: m.listRepoBranches,
}));

import { POST as signOut } from "@/app/api/auth/sign-out/route";
import { DELETE as deleteInstallation } from "@/app/api/github/installations/[id]/route";
import { GET as listBranches } from "@/app/api/github/installations/[id]/branches/route";
import { GET as listRepos } from "@/app/api/github/installations/[id]/repos/route";
import { PATCH as patchProfile } from "@/app/api/profile/route";
import { DELETE as deleteProject } from "@/app/api/projects/[id]/route";
import { POST as createProjectRoute } from "@/app/api/projects/route";

const installationRow = {
  id: INSTALL_A,
  user_id: USER_A,
  installation_id: 4242,
  account_login: "octo",
  created_at: "2026-11-12T10:00:00+00:00",
  github_user_id: 9001,
  github_user_login: "octocat",
  repos_synced_at: new Date().toISOString(),
};

/** The user's access set in the fake DB (D-22): GitHub repo ids per name. */
const REPO_IDS: Record<string, number> = {
  "octo/site": 101,
  "other/repo": 102,
  "torvalds/linux": 103,
  "other-org/app": 104,
};

function seedAccessSet(names: string[] = Object.keys(REPO_IDS), syncedAt: string | null = new Date().toISOString()) {
  const current = fake.createFakeDb();
  current.installations.push({ ...installationRow, repos_synced_at: syncedAt });
  for (const name of names) {
    current.repos.push({
      user_id: USER_A,
      installation_id: INSTALL_A,
      repo_id: REPO_IDS[name] ?? 999,
      repo_full_name: name,
      private: true,
      default_branch: "main",
    });
  }
  db.current = current;
}

const projectRow = {
  id: PROJECT_A,
  user_id: USER_A,
  installation_id: INSTALL_A,
  repo_full_name: "octo/site",
  repo_id: 101,
  default_branch: "main",
  branch: "main",
  status: "pending" as const,
  invalid_reason: null,
  detected_kind: null,
  last_commit_sha: null,
  stale: false,
  created_at: "2026-11-12T10:00:00+00:00",
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const noParams = { params: Promise.resolve({}) };

function jsonRequest(method: string, path: string, body?: unknown, origin?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== undefined) headers.origin = origin;
  return new Request(`https://app.example.com${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.getUser.mockResolvedValue({ data: { user: { id: USER_A, email: "a@example.com" } }, error: null });
  seedAccessSet();
});

describe("POST /api/projects ownership", () => {
  it("installation owned by another user → 400 VALIDATION_ERROR, no token minted, nothing created", async () => {
    m.getInstallationForUser.mockResolvedValue(null);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: FOREIGN_ID, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(m.getInstallationForUser).toHaveBeenCalledWith(USER_A, FOREIGN_ID);
    expect(m.mint).not.toHaveBeenCalled();
    expect(m.createProject).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("repo outside the installation (GitHub 404) → 400, nothing created", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue(null);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "other/repo", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(m.mint).toHaveBeenCalledWith(4242);
    expect(m.getInstallationRepo).toHaveBeenCalledWith({ token: "ghs_test" }, "other/repo");
    expect(m.createProject).not.toHaveBeenCalled();
  });

  it("duplicate repo → 400 with the contract message", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 101, fullName: "octo/site", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(4242);
    m.getBranch.mockResolvedValue({ name: "main", headSha: "a".repeat(40) });
    m.createProject.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "This repository and branch are already connected"),
    );
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("This repository and branch are already connected");
  });

  it("public repo the App is not installed on (installation 404) → 400, nothing created (R1-14)", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 103, fullName: "torvalds/linux", defaultBranch: "master", private: false });
    m.repoInstallationId.mockResolvedValue(null);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "torvalds/linux", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(m.repoInstallationId).toHaveBeenCalledWith("torvalds/linux");
    expect(m.createProject).not.toHaveBeenCalled();
  });

  it("repo covered by a different installation → 400, nothing created (R1-14)", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 104, fullName: "other-org/app", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(9999);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "other-org/app", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect(m.createProject).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("success (matching installation) → 201 Project DTO with GitHub's canonical name/branch, plus audit", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.repoInstallationId.mockResolvedValue(4242);
    m.getInstallationRepo.mockResolvedValue({ id: 101, fullName: "octo/site", defaultBranch: "trunk", private: true });
    m.getBranch.mockResolvedValue({ name: "Feature/X", headSha: "a".repeat(40) });
    m.createProject.mockResolvedValue({ ...projectRow, default_branch: "trunk", branch: "Feature/X" });
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "Octo/Site", installationId: INSTALL_A, branch: "feature/x" }),
      noParams,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: PROJECT_A,
      defaultBranch: "trunk",
      branch: "Feature/X",
      installationId: INSTALL_A,
    });
    expect(m.getBranch).toHaveBeenCalledWith({ token: "ghs_test" }, "octo/site", "feature/x");
    // GitHub's spelling of the branch is stored, not the request's.
    expect(m.createProject).toHaveBeenCalledWith({
      userId: USER_A,
      installationRowId: INSTALL_A,
      repoFullName: "octo/site",
      repoId: 101,
      defaultBranch: "trunk",
      branch: "Feature/X",
    });
    expect(m.audit).toHaveBeenCalledWith(USER_A, "project.create", PROJECT_A);
  });

  it("missing branch → 400 VALIDATION_ERROR before any lookup", async () => {
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(m.getInstallationForUser).not.toHaveBeenCalled();
    expect(m.createProject).not.toHaveBeenCalled();
  });

  it("invalid branch name → 400 VALIDATION_ERROR, no GitHub call", async () => {
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A, branch: "a..b" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect(m.mint).not.toHaveBeenCalled();
  });

  it("branch 404 on GitHub → 400 'That branch was not found.', nothing created", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 101, fullName: "octo/site", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(4242);
    m.getBranch.mockResolvedValue(null);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A, branch: "gone" }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      code: "VALIDATION_ERROR",
      message: "That branch was not found.",
    });
    expect(m.createProject).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("same repo with another branch → accepted (unique key includes branch)", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 101, fullName: "octo/site", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(4242);
    m.getBranch.mockResolvedValue({ name: "develop", headSha: "b".repeat(40) });
    m.createProject.mockResolvedValue({ ...projectRow, branch: "develop" });
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A, branch: "develop" }),
      noParams,
    );
    expect(response.status).toBe(201);
    expect((await response.json()).data.branch).toBe("develop");
  });

  it("unauthenticated → 401 before any lookup", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(401);
    expect(m.getInstallationForUser).not.toHaveBeenCalled();
  });
});

describe("GET /api/github/installations/:id/repos ownership", () => {
  it("foreign id → 404, no GitHub call", async () => {
    m.getInstallationForUser.mockResolvedValue(null);
    const response = await listRepos(
      new Request(`https://app.example.com/api/github/installations/${FOREIGN_ID}/repos?page=1`),
      ctx(FOREIGN_ID),
    );
    expect(response.status).toBe(404);
    expect(m.getInstallationForUser).toHaveBeenCalledWith(USER_A, FOREIGN_ID);
    expect(m.mint).not.toHaveBeenCalled();
    expect(m.listInstallationRepos).not.toHaveBeenCalled();
  });

  it("own id → repos page served from the access set, sorted case-insensitively, no GitHub call", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    const response = await listRepos(
      new Request(`https://app.example.com/api/github/installations/${INSTALL_A}/repos?page=1`),
      ctx(INSTALL_A),
    );
    const body = await response.json();
    expect(body.data.repos.map((repo: { fullName: string }) => repo.fullName)).toEqual([
      "octo/site",
      // "-" (0x2d) sorts before "/" (0x2f)
      "other-org/app",
      "other/repo",
      "torvalds/linux",
    ]);
    expect(body.data).toMatchObject({ page: 1, hasMore: false });
    expect(m.mint).not.toHaveBeenCalled();
    expect(m.listInstallationRepos).not.toHaveBeenCalled();
  });
});

describe("GET /api/github/installations/:id/branches", () => {
  const url = (id: string, query: string) =>
    new Request(`https://app.example.com/api/github/installations/${id}/branches?${query}`);

  it("foreign installation id → 404, no GitHub call", async () => {
    m.getInstallationForUser.mockResolvedValue(null);
    const response = await listBranches(url(FOREIGN_ID, "repo=octo/site"), ctx(FOREIGN_ID));
    expect(response.status).toBe(404);
    expect(m.getInstallationForUser).toHaveBeenCalledWith(USER_A, FOREIGN_ID);
    expect(m.mint).not.toHaveBeenCalled();
    expect(m.listRepoBranches).not.toHaveBeenCalled();
  });

  it("repo not covered by the installation → 400 VALIDATION_ERROR, branches never listed", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 103, fullName: "torvalds/linux", defaultBranch: "master", private: false });
    m.repoInstallationId.mockResolvedValue(null);
    const response = await listBranches(url(INSTALL_A, "repo=torvalds/linux"), ctx(INSTALL_A));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      code: "VALIDATION_ERROR",
      message: "This repository is not available through the selected GitHub installation.",
    });
    expect(m.listRepoBranches).not.toHaveBeenCalled();
  });

  it("repo the installation token cannot read (404) → 400", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue(null);
    const response = await listBranches(url(INSTALL_A, "repo=other/repo"), ctx(INSTALL_A));
    expect(response.status).toBe(400);
    expect(m.listRepoBranches).not.toHaveBeenCalled();
  });

  it("bad query (missing repo, page out of range) → 400", async () => {
    expect((await listBranches(url(INSTALL_A, "page=1"), ctx(INSTALL_A))).status).toBe(400);
    expect((await listBranches(url(INSTALL_A, "repo=octo/site&page=101"), ctx(INSTALL_A))).status).toBe(400);
    expect(m.getInstallationForUser).not.toHaveBeenCalled();
  });

  it("covered repo → branches page with defaultBranch, page and hasMore", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 101, fullName: "octo/site", defaultBranch: "trunk", private: false });
    m.repoInstallationId.mockResolvedValue(4242);
    m.listRepoBranches.mockResolvedValue({
      branches: [
        { name: "feature/x", protected: false },
        { name: "release", protected: true },
      ],
      hasMore: true,
    });
    const response = await listBranches(url(INSTALL_A, "repo=octo/site&page=2"), ctx(INSTALL_A));
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        branches: [
          { name: "feature/x", protected: false },
          { name: "release", protected: true },
        ],
        defaultBranch: "trunk",
        page: 2,
        hasMore: true,
      },
    });
    expect(m.listRepoBranches).toHaveBeenCalledWith({ token: "ghs_test" }, "octo/site", 2);
  });

  it("malformed GitHub branch item → 500 INTERNAL", async () => {
    const { GitHubResponseError } = await import("@/lib/github/errors");
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ id: 101, fullName: "octo/site", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(4242);
    m.listRepoBranches.mockRejectedValue(new GitHubResponseError("list branches"));
    const response = await listBranches(url(INSTALL_A, "repo=octo/site"), ctx(INSTALL_A));
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL");
  });

  it("unauthenticated → 401", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await listBranches(url(INSTALL_A, "repo=octo/site"), ctx(INSTALL_A));
    expect(response.status).toBe(401);
    expect(m.getInstallationForUser).not.toHaveBeenCalled();
  });
});

describe("D-22 per-user repo access (S11-1)", () => {
  // An org installation covers octo-org/a, octo-org/b and octo-org/c, but this
  // member can reach only octo-org/a, so only that repo is in the set.
  const ORG_IDS: Record<string, number> = { "octo-org/a": 201, "octo-org/b": 202, "octo-org/c": 203 };
  beforeEach(() => {
    Object.assign(REPO_IDS, ORG_IDS);
    seedAccessSet(["octo-org/a"]);
    m.getInstallationForUser.mockResolvedValue(installationRow);
    // GitHub (installation token) would happily read every repo of the installation.
    // GitHub resolves names case-insensitively and returns the canonical spelling.
    m.getInstallationRepo.mockImplementation(async (_client: unknown, name: string) => ({
      id: ORG_IDS[name.toLowerCase()] ?? 999,
      fullName: name.toLowerCase(),
      defaultBranch: "main",
      private: true,
    }));
    m.repoInstallationId.mockResolvedValue(4242);
    m.getBranch.mockResolvedValue({ name: "main", headSha: "a".repeat(40) });
    m.listRepoBranches.mockResolvedValue({ branches: [{ name: "main", protected: false }], hasMore: false, skipped: 0 });
  });

  const branchesUrl = (repo: string) =>
    new Request(`https://app.example.com/api/github/installations/${INSTALL_A}/branches?repo=${repo}`);
  const expectRefresh = async (response: Response) => {
    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({
      code: "GITHUB_REFRESH_REQUIRED",
      message: "Refresh repository access to continue.",
    });
  };

  it("repos list shows only the repo the member can access", async () => {
    const response = await listRepos(
      new Request(`https://app.example.com/api/github/installations/${INSTALL_A}/repos`),
      ctx(INSTALL_A),
    );
    expect((await response.json()).data.repos).toEqual([
      { fullName: "octo-org/a", defaultBranch: "main", private: true },
    ]);
  });

  it("branches for an inaccessible repo → GITHUB_REFRESH_REQUIRED with no GitHub call", async () => {
    await expectRefresh(await listBranches(branchesUrl("octo-org/b"), ctx(INSTALL_A)));
    expect(m.mint).not.toHaveBeenCalled();
    expect(m.getInstallationRepo).not.toHaveBeenCalled();
    expect(m.listRepoBranches).not.toHaveBeenCalled();
  });

  it("POST /api/projects for an inaccessible repo → GITHUB_REFRESH_REQUIRED, nothing created, no GitHub call", async () => {
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo-org/c", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    await expectRefresh(response);
    expect(m.mint).not.toHaveBeenCalled();
    expect(m.createProject).not.toHaveBeenCalled();
  });

  it("accessible repo works end to end: branches and project creation (stores repo_id)", async () => {
    const branches = await listBranches(branchesUrl("octo-org/a"), ctx(INSTALL_A));
    expect(branches.status).toBe(200);
    m.createProject.mockResolvedValue({ ...projectRow, repo_full_name: "octo-org/a", repo_id: 201 });
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "OCTO-ORG/A", installationId: INSTALL_A, branch: "main" }),
      noParams,
    );
    expect(response.status).toBe(201);
    expect(m.createProject).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: "octo-org/a", repoId: 201 }));
  });

  it("stale set (synced 25 h ago) → GITHUB_REFRESH_REQUIRED on repos, branches and create", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    seedAccessSet(["octo-org/a"], stale);
    m.getInstallationForUser.mockResolvedValue({ ...installationRow, repos_synced_at: stale });
    await expectRefresh(
      await listRepos(new Request(`https://app.example.com/api/github/installations/${INSTALL_A}/repos`), ctx(INSTALL_A)),
    );
    await expectRefresh(await listBranches(branchesUrl("octo-org/a"), ctx(INSTALL_A)));
    await expectRefresh(
      await createProjectRoute(
        jsonRequest("POST", "/api/projects", { repoFullName: "octo-org/a", installationId: INSTALL_A, branch: "main" }),
        noParams,
      ),
    );
    expect(m.mint).not.toHaveBeenCalled();
  });

  it("never-synced set (row linked before D-22) → GITHUB_REFRESH_REQUIRED", async () => {
    seedAccessSet([], null);
    m.getInstallationForUser.mockResolvedValue({ ...installationRow, repos_synced_at: null, github_user_id: null });
    await expectRefresh(
      await listRepos(new Request(`https://app.example.com/api/github/installations/${INSTALL_A}/repos`), ctx(INSTALL_A)),
    );
    await expectRefresh(await listBranches(branchesUrl("octo-org/a"), ctx(INSTALL_A)));
  });

  it("repo id mismatch (deleted and recreated under the same name) → GITHUB_REFRESH_REQUIRED, nothing created", async () => {
    m.getInstallationRepo.mockResolvedValue({ id: 777, fullName: "octo-org/a", defaultBranch: "main", private: true });
    await expectRefresh(await listBranches(branchesUrl("octo-org/a"), ctx(INSTALL_A)));
    await expectRefresh(
      await createProjectRoute(
        jsonRequest("POST", "/api/projects", { repoFullName: "octo-org/a", installationId: INSTALL_A, branch: "main" }),
        noParams,
      ),
    );
    expect(m.listRepoBranches).not.toHaveBeenCalled();
    expect(m.createProject).not.toHaveBeenCalled();
  });

  it("another user's access set never grants access", async () => {
    const other = db.current;
    if (other === null) throw new Error("no db");
    other.repos = other.repos.map((repo) => ({ ...repo, user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));
    await expectRefresh(await listBranches(branchesUrl("octo-org/a"), ctx(INSTALL_A)));
  });

  it("S11-4: repo names with . or .. segments are rejected before any lookup", async () => {
    for (const repo of ["../meta", "octo/..", "octo/.", "./x"]) {
      const response = await listBranches(branchesUrl(repo), ctx(INSTALL_A));
      expect(response.status).toBe(400);
    }
    expect(m.getInstallationForUser).not.toHaveBeenCalled();
  });
});

describe("DELETE routes with a foreign id", () => {
  it("DELETE /api/github/installations/:id → 404, no audit", async () => {
    m.deleteInstallationForUser.mockRejectedValue(new ApiError("NOT_FOUND"));
    const response = await deleteInstallation(
      jsonRequest("DELETE", `/api/github/installations/${FOREIGN_ID}`),
      ctx(FOREIGN_ID),
    );
    expect(response.status).toBe(404);
    expect(m.deleteInstallationForUser).toHaveBeenCalledWith(USER_A, FOREIGN_ID);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("DELETE /api/projects/:id → 404, no audit", async () => {
    m.deleteProjectForUser.mockRejectedValue(new ApiError("NOT_FOUND"));
    const response = await deleteProject(jsonRequest("DELETE", `/api/projects/${FOREIGN_ID}`), ctx(FOREIGN_ID));
    expect(response.status).toBe(404);
    expect(m.deleteProjectForUser).toHaveBeenCalledWith(USER_A, FOREIGN_ID);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("DELETE /api/projects/:id own id → deleted + audit", async () => {
    m.deleteProjectForUser.mockResolvedValue(undefined);
    const response = await deleteProject(jsonRequest("DELETE", `/api/projects/${PROJECT_A}`), ctx(PROJECT_A));
    expect(await response.json()).toEqual({ ok: true, data: { deleted: true } });
    expect(m.audit).toHaveBeenCalledWith(USER_A, "project.delete", PROJECT_A);
  });
});

describe("CSRF Origin check on every state-changing route", () => {
  const EVIL = "https://evil.example";
  const cases: [string, () => Promise<Response>][] = [
    ["POST /api/auth/sign-out", () => signOut(jsonRequest("POST", "/api/auth/sign-out", undefined, EVIL), noParams)],
    [
      "PATCH /api/profile",
      () => patchProfile(jsonRequest("PATCH", "/api/profile", { displayName: "Ada" }, EVIL), noParams),
    ],
    [
      "POST /api/projects",
      () =>
        createProjectRoute(
          jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A }, EVIL),
          noParams,
        ),
    ],
    [
      "DELETE /api/projects/:id",
      () => deleteProject(jsonRequest("DELETE", `/api/projects/${PROJECT_A}`, undefined, EVIL), ctx(PROJECT_A)),
    ],
    [
      "DELETE /api/github/installations/:id",
      () =>
        deleteInstallation(
          jsonRequest("DELETE", `/api/github/installations/${INSTALL_A}`, undefined, EVIL),
          ctx(INSTALL_A),
        ),
    ],
  ];

  for (const [name, run] of cases) {
    it(`${name} with a foreign Origin → 403 FORBIDDEN and no side effect`, async () => {
      const response = await run();
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
      expect(m.signOut).not.toHaveBeenCalled();
      expect(m.updateDisplayName).not.toHaveBeenCalled();
      expect(m.createProject).not.toHaveBeenCalled();
      expect(m.deleteProjectForUser).not.toHaveBeenCalled();
      expect(m.deleteInstallationForUser).not.toHaveBeenCalled();
      expect(m.audit).not.toHaveBeenCalled();
    });
  }

  it("same-origin sign-out succeeds", async () => {
    const response = await signOut(
      jsonRequest("POST", "/api/auth/sign-out", undefined, "https://app.example.com"),
      noParams,
    );
    expect(await response.json()).toEqual({ ok: true, data: { signedOut: true } });
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
