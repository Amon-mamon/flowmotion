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
  audit: vi.fn(async () => undefined),
  updateDisplayName: vi.fn(),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ APP_URL: "https://app.example.com" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: m.getUser, signOut: m.signOut } }),
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
}));

import { POST as signOut } from "@/app/api/auth/sign-out/route";
import { DELETE as deleteInstallation } from "@/app/api/github/installations/[id]/route";
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
};

const projectRow = {
  id: PROJECT_A,
  user_id: USER_A,
  installation_id: INSTALL_A,
  repo_full_name: "octo/site",
  default_branch: "main",
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
});

describe("POST /api/projects ownership", () => {
  it("installation owned by another user → 400 VALIDATION_ERROR, no token minted, nothing created", async () => {
    m.getInstallationForUser.mockResolvedValue(null);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: FOREIGN_ID }),
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
      jsonRequest("POST", "/api/projects", { repoFullName: "other/repo", installationId: INSTALL_A }),
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
    m.getInstallationRepo.mockResolvedValue({ fullName: "octo/site", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(4242);
    m.createProject.mockRejectedValue(new ApiError("VALIDATION_ERROR", "This repository is already connected"));
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("This repository is already connected");
  });

  it("public repo the App is not installed on (installation 404) → 400, nothing created (R1-14)", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ fullName: "torvalds/linux", defaultBranch: "master", private: false });
    m.repoInstallationId.mockResolvedValue(null);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "torvalds/linux", installationId: INSTALL_A }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(m.repoInstallationId).toHaveBeenCalledWith("torvalds/linux");
    expect(m.createProject).not.toHaveBeenCalled();
  });

  it("repo covered by a different installation → 400, nothing created (R1-14)", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.getInstallationRepo.mockResolvedValue({ fullName: "other-org/app", defaultBranch: "main", private: false });
    m.repoInstallationId.mockResolvedValue(9999);
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "other-org/app", installationId: INSTALL_A }),
      noParams,
    );
    expect(response.status).toBe(400);
    expect(m.createProject).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("success (matching installation) → 201 Project DTO with GitHub's canonical name/branch, plus audit", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.repoInstallationId.mockResolvedValue(4242);
    m.getInstallationRepo.mockResolvedValue({ fullName: "octo/site", defaultBranch: "trunk", private: true });
    m.createProject.mockResolvedValue({ ...projectRow, default_branch: "trunk" });
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "Octo/Site", installationId: INSTALL_A }),
      noParams,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({ id: PROJECT_A, defaultBranch: "trunk", installationId: INSTALL_A });
    expect(m.createProject).toHaveBeenCalledWith({
      userId: USER_A,
      installationRowId: INSTALL_A,
      repoFullName: "octo/site",
      defaultBranch: "trunk",
    });
    expect(m.audit).toHaveBeenCalledWith(USER_A, "project.create", PROJECT_A);
  });

  it("unauthenticated → 401 before any lookup", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await createProjectRoute(
      jsonRequest("POST", "/api/projects", { repoFullName: "octo/site", installationId: INSTALL_A }),
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

  it("own id → repos page", async () => {
    m.getInstallationForUser.mockResolvedValue(installationRow);
    m.listInstallationRepos.mockResolvedValue({ repos: [], page: 2, hasMore: false });
    const response = await listRepos(
      new Request(`https://app.example.com/api/github/installations/${INSTALL_A}/repos?page=2`),
      ctx(INSTALL_A),
    );
    expect(await response.json()).toEqual({ ok: true, data: { repos: [], page: 2, hasMore: false } });
    expect(m.listInstallationRepos).toHaveBeenCalledWith({ token: "ghs_test" }, 2);
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
