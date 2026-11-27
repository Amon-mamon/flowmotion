// @vitest-environment node
/**
 * Phase 2 routes: POST /api/projects/:id/analyze (check order, D-22 access
 * gate before any insert, daily cap, branch copy), GET /api/analyses/:id
 * (ownership, DTO, poll kick), findings and recommendations (analysisId
 * ownership, default latest done analysis, sorting).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/server/http";

import { tablesFrom, type Tables } from "./helpers/fake-tables";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_A2 = "33333333-3333-4333-8333-333333333334";
const ANALYSIS_1 = "44444444-4444-4444-8444-444444444441";
const ANALYSIS_2 = "44444444-4444-4444-8444-444444444442";
const ANALYSIS_B = "44444444-4444-4444-8444-44444444444b";
const NEW_ANALYSIS = "44444444-4444-4444-8444-444444444499";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  order: [] as string[],
  selects: [] as { table: string; columns: string }[],
}));

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  getProjectForUser: vi.fn(),
  createAnalysisWithJob: vi.fn(),
  setProjectRepoId: vi.fn(async () => undefined),
  dailyHit: vi.fn(async () => true),
  enforceUserLimit: vi.fn(async () => undefined),
  scheduleWorkerTrigger: vi.fn(),
  pollKick: vi.fn(async (): Promise<"none" | "kicked" | "expired"> => "none"),
  expireStaleJobs: vi.fn(async () => {
    state.order.push("expire");
    return 0;
  }),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ APP_URL: "https://app.example.com" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: m.getUser },
    from: (table: string) => {
      state.order.push(`select:${table}`);
      return tablesFrom(state.tables as Tables, (t, columns) => state.selects.push({ table: t, columns }))(table);
    },
  }),
}));
vi.mock("@/server/rate-limit", () => ({
  RATE_LIMITS: { api: 120, heavy: 10, auth: 20, webhook: 60 },
  enforceUserLimit: m.enforceUserLimit,
  enforceIpLimit: vi.fn(async () => undefined),
  hitViaDatabase: m.dailyHit,
}));
vi.mock("@/server/audit", () => ({ audit: m.audit }));
vi.mock("@/server/projects", () => ({ getProjectForUser: m.getProjectForUser }));
vi.mock("@/server/jobs/trigger", () => ({
  scheduleWorkerTrigger: m.scheduleWorkerTrigger,
  pollKick: m.pollKick,
  expireStaleJobs: m.expireStaleJobs,
}));
vi.mock("@/server/analyses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/analyses")>()),
  createAnalysisWithJob: m.createAnalysisWithJob,
  setProjectRepoId: m.setProjectRepoId,
}));

import { GET as getAnalysis } from "@/app/api/analyses/[id]/route";
import { POST as analyze } from "@/app/api/projects/[id]/analyze/route";
import { GET as getFindings } from "@/app/api/projects/[id]/findings/route";
import { GET as getRecommendations } from "@/app/api/projects/[id]/recommendations/route";
import { analysisSchema, findingsResponseSchema } from "@/schemas/analysis";
import { recommendationsResponseSchema } from "@/schemas/recommendation";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function request(method: string, path: string, origin?: string): Request {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: origin === undefined ? {} : { origin },
  });
}

const projectRow = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT_A,
  user_id: USER_A,
  installation_id: INSTALL_A,
  repo_full_name: "octo/site",
  repo_id: 101,
  default_branch: "main",
  branch: "release/v2",
  status: "valid" as const,
  invalid_reason: null,
  detected_kind: "website" as const,
  last_commit_sha: null,
  stale: false,
  created_at: "2026-11-12T10:00:00+00:00",
  ...overrides,
});

const analysisRow = (overrides: Record<string, unknown> = {}) => ({
  id: ANALYSIS_1,
  project_id: PROJECT_A,
  user_id: USER_A,
  status: "done",
  progress: 100,
  branch: "release/v2",
  commit_sha: "c".repeat(40),
  validation: { kind: "website", reason: null },
  files_considered: 10,
  files_read: 6,
  files_blocked: 4,
  files_blocked_by_reason: { denied: 1, extension: 2, size: 1 },
  files_skipped_budget: 0,
  signals: [{ kind: "route", filePath: "a.ts", line: 1, label: "GET /x" }, { kind: "bogus" }],
  error_code: "AI_DISABLED",
  started_at: "2026-11-13T10:00:00+00:00",
  finished_at: "2026-11-13T10:01:00+00:00",
  ...overrides,
});

const finding = (id: string, severity: string, filePath: string, line: number | null, analysisId = ANALYSIS_1) => ({
  id,
  analysis_id: analysisId,
  user_id: USER_A,
  category: severity === "low" ? "debug_config" : "hardcoded_secret",
  severity,
  file_path: filePath,
  line,
  masked_evidence: "GitHub token: gh…R8",
  remediation: "Rotate it.",
});

const recommendation = (id: string, title: string, confidence: number, analysisId = ANALYSIS_1) => ({
  id,
  analysis_id: analysisId,
  user_id: USER_A,
  title,
  description: "Post to Slack when an order arrives.",
  trigger_kind: "webhook",
  confidence,
  source_files: ["src/orders.ts"],
  required_credentials: ["Slack"],
  risk_level: "low",
  node_types: ["n8n-nodes-base.webhook"],
  rationale: "Orders arrive by webhook.",
  estimated_tokens: 4100,
  status: "new",
});

function seed(options: { syncedAt?: string | null; repos?: { repo_id: number; repo_full_name: string }[] } = {}) {
  state.tables = {
    github_installations: [
      {
        id: INSTALL_A,
        user_id: USER_A,
        installation_id: 4242,
        repos_synced_at: options.syncedAt === undefined ? new Date().toISOString() : options.syncedAt,
      },
    ],
    github_installation_repos: (options.repos ?? [{ repo_id: 101, repo_full_name: "octo/site" }]).map((repo) => ({
      user_id: USER_A,
      installation_id: INSTALL_A,
      private: true,
      default_branch: "main",
      ...repo,
    })),
    analyses: [
      analysisRow(),
      analysisRow({ id: ANALYSIS_2, status: "failed", error_code: "MODEL_OUTPUT_INVALID", finished_at: "2026-11-13T11:00:00+00:00" }),
      analysisRow({ id: ANALYSIS_B, user_id: USER_B }),
    ],
    security_findings: [
      finding("f0000000-0000-4000-8000-000000000001", "low", "settings.py", 3),
      finding("f0000000-0000-4000-8000-000000000002", "high", "b.ts", 9),
      finding("f0000000-0000-4000-8000-000000000003", "high", "a.ts", 2),
      finding("f0000000-0000-4000-8000-000000000004", "high", "a.ts", null),
      finding("f0000000-0000-4000-8000-000000000005", "high", "x.ts", 1, ANALYSIS_2),
    ],
    recommendations: [
      recommendation("e0000000-0000-4000-8000-000000000001", "Beta", 0.5),
      recommendation("e0000000-0000-4000-8000-000000000002", "Alpha", 0.5),
      recommendation("e0000000-0000-4000-8000-000000000003", "Top", 0.9),
    ],
    jobs: [],
    flows: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  state.order = [];
  state.selects = [];
  seed();
  m.getUser.mockResolvedValue({ data: { user: { id: USER_A, email: "a@example.com" } }, error: null });
  m.getProjectForUser.mockImplementation(async (userId: string, id: string) => {
    state.order.push("getProject");
    return userId === USER_A && id === PROJECT_A ? projectRow() : null;
  });
  m.createAnalysisWithJob.mockImplementation(async () => {
    state.order.push("insert");
    return NEW_ANALYSIS;
  });
  m.dailyHit.mockImplementation(async () => {
    state.order.push("dailyCap");
    return true;
  });
});

async function body(response: Response) {
  return (await response.json()) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}

describe("POST /api/projects/:id/analyze", () => {
  it("success → 202 { analysisId }; branch copied from the project; trigger + audit", async () => {
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`, "https://app.example.com"), ctx(PROJECT_A));
    expect(response.status).toBe(202);
    expect(await body(response)).toEqual({ ok: true, data: { analysisId: NEW_ANALYSIS } });
    expect(m.createAnalysisWithJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_A, projectId: PROJECT_A, branch: "release/v2" }),
    );
    expect(m.scheduleWorkerTrigger).toHaveBeenCalledWith({ userId: USER_A });
    expect(m.audit).toHaveBeenCalledWith(USER_A, "analysis.start", NEW_ANALYSIS);
    expect(m.enforceUserLimit).toHaveBeenCalledWith("projects.analyze", USER_A, 10);
  });

  it("check order: project → repo access → active check → daily cap → insert", async () => {
    await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    const relevant = state.order.filter((step) =>
      ["getProject", "select:github_installations", "select:github_installation_repos", "expire", "select:analyses", "dailyCap", "insert"].includes(step),
    );
    expect(relevant).toEqual([
      "getProject",
      "select:github_installations",
      "select:github_installation_repos",
      "expire",
      "select:analyses",
      "dailyCap",
      "insert",
    ]);
  });

  it("unauthenticated → 401 before anything", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(401);
    expect(m.getProjectForUser).not.toHaveBeenCalled();
  });

  it("cross-origin → 403 FORBIDDEN", async () => {
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`, "https://evil.example"), ctx(PROJECT_A));
    expect(response.status).toBe(403);
    expect((await body(response)).error?.code).toBe("FORBIDDEN");
    expect(m.getProjectForUser).not.toHaveBeenCalled();
  });

  it("rate limited → 429 RATE_LIMITED", async () => {
    m.enforceUserLimit.mockRejectedValueOnce(new ApiError("RATE_LIMITED"));
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(429);
    expect(m.getProjectForUser).not.toHaveBeenCalled();
  });

  it("malformed id or another user's project → 404 NOT_FOUND", async () => {
    expect((await analyze(request("POST", "/api/projects/x/analyze"), ctx("not-a-uuid"))).status).toBe(404);
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A2}/analyze`), ctx(PROJECT_A2));
    expect(response.status).toBe(404);
    expect(m.createAnalysisWithJob).not.toHaveBeenCalled();
  });

  it("installation removed → VALIDATION_ERROR reconnect, no access check", async () => {
    m.getProjectForUser.mockResolvedValue(projectRow({ installation_id: null }));
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(400);
    expect((await body(response)).error?.message).toBe("Reconnect GitHub to analyze this project");
    expect(state.order).not.toContain("select:github_installations");
  });

  it("stale access set → 403 GITHUB_REFRESH_REQUIRED, no cap consumed, nothing inserted", async () => {
    seed({ syncedAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(403);
    expect((await body(response)).error?.code).toBe("GITHUB_REFRESH_REQUIRED");
    expect(m.dailyHit).not.toHaveBeenCalled();
    expect(m.createAnalysisWithJob).not.toHaveBeenCalled();
  });

  it("repo no longer in the access set (matched by projects.repo_id) → GITHUB_REFRESH_REQUIRED", async () => {
    seed({ repos: [{ repo_id: 555, repo_full_name: "octo/site" }] });
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(403);
    expect(m.createAnalysisWithJob).not.toHaveBeenCalled();
  });

  it("S2-1: access row matched by id but under another name → GITHUB_REFRESH_REQUIRED", async () => {
    seed({ repos: [{ repo_id: 101, repo_full_name: "octo/site-legacy" }] });
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(403);
    expect((await body(response)).error?.code).toBe("GITHUB_REFRESH_REQUIRED");
    expect(m.createAnalysisWithJob).not.toHaveBeenCalled();
  });

  it("D-29: analyze after an expired chain is accepted (expiry runs before the active check)", async () => {
    state.tables.analyses?.push(analysisRow({ id: "44444444-4444-4444-8444-444444444478", status: "scanning" }));
    m.expireStaleJobs.mockImplementationOnce(async () => {
      state.order.push("expire");
      for (const row of state.tables.analyses ?? []) {
        if (row.status === "scanning") Object.assign(row, { status: "failed", error_code: "JOB_EXPIRED" });
      }
      return 1;
    });
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(202);
  });

  it("project without repo_id is matched by name and gets repo_id stored", async () => {
    m.getProjectForUser.mockResolvedValue(projectRow({ repo_id: null, repo_full_name: "Octo/Site" }));
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(202);
    expect(m.setProjectRepoId).toHaveBeenCalledWith(USER_A, PROJECT_A, 101);
  });

  it("an active analysis → VALIDATION_ERROR 'An analysis is already running', cap untouched", async () => {
    state.tables.analyses?.push(analysisRow({ id: "44444444-4444-4444-8444-444444444477", status: "scanning" }));
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(400);
    expect((await body(response)).error?.message).toBe("An analysis is already running");
    expect(m.dailyHit).not.toHaveBeenCalled();
  });

  it("racing insert (unique index) → same VALIDATION_ERROR", async () => {
    m.createAnalysisWithJob.mockRejectedValueOnce(new ApiError("VALIDATION_ERROR", "An analysis is already running"));
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(400);
    expect(m.scheduleWorkerTrigger).not.toHaveBeenCalled();
  });

  it("daily cap reached → 429 DAILY_CAP_REACHED with the reset message, nothing inserted", async () => {
    m.dailyHit.mockResolvedValueOnce(false);
    const response = await analyze(request("POST", `/api/projects/${PROJECT_A}/analyze`), ctx(PROJECT_A));
    expect(response.status).toBe(429);
    const json = await body(response);
    expect(json.error).toEqual({
      code: "DAILY_CAP_REACHED",
      message: "Daily limit of 10 analyses reached. It resets at 00:00 UTC.",
    });
    expect(m.createAnalysisWithJob).not.toHaveBeenCalled();
    const key = (m.dailyHit.mock.calls[0] as unknown as [string, number])[0];
    expect(key).toMatch(new RegExp(`^daily:analyze:${USER_A}:\\d{4}-\\d{2}-\\d{2}$`));
  });
});

describe("GET /api/analyses/:id", () => {
  it("returns the Analysis DTO (missing cap → 0, invalid signals dropped)", async () => {
    const response = await getAnalysis(request("GET", `/api/analyses/${ANALYSIS_1}`), ctx(ANALYSIS_1));
    expect(response.status).toBe(200);
    const json = await body(response);
    const dto = analysisSchema.parse(json.data);
    expect(dto.counts.filesBlockedByReason).toEqual({ denied: 1, extension: 2, size: 1, cap: 0 });
    expect(dto.signals).toHaveLength(1);
    expect(dto.errorCode).toBe("AI_DISABLED");
    expect(dto.branch).toBe("release/v2");
    expect(dto.finishedAt).toBe("2026-11-13T10:01:00.000Z");
    expect(m.pollKick).not.toHaveBeenCalled();
  });

  it("never selects jobs.state", async () => {
    await getAnalysis(request("GET", `/api/analyses/${ANALYSIS_1}`), ctx(ANALYSIS_1));
    expect(state.selects.some((s) => s.table === "jobs")).toBe(false);
    expect(state.selects.every((s) => !s.columns.includes("state"))).toBe(true);
  });

  it("another user's analysis or a malformed id → 404", async () => {
    expect((await getAnalysis(request("GET", "/"), ctx(ANALYSIS_B))).status).toBe(404);
    expect((await getAnalysis(request("GET", "/"), ctx("nope"))).status).toBe(404);
  });

  it("D-29: polling an expired chain returns failed / JOB_EXPIRED", async () => {
    state.tables.analyses = [analysisRow({ status: "scanning", progress: 30, error_code: null, finished_at: null })];
    m.pollKick.mockImplementationOnce(async () => {
      Object.assign(state.tables.analyses?.[0] ?? {}, { status: "failed", error_code: "JOB_EXPIRED", finished_at: "2026-11-13T12:00:00+00:00" });
      return "expired";
    });
    const response = await getAnalysis(request("GET", "/"), ctx(ANALYSIS_1));
    const dto = analysisSchema.parse((await body(response)).data);
    expect(dto.status).toBe("failed");
    expect(dto.errorCode).toBe("JOB_EXPIRED");
  });

  it("an active analysis applies the poll kick", async () => {
    state.tables.analyses = [analysisRow({ status: "scanning", progress: 30, error_code: null, finished_at: null })];
    const response = await getAnalysis(request("GET", "/"), ctx(ANALYSIS_1));
    expect(response.status).toBe(200);
    expect(m.pollKick).toHaveBeenCalledWith(USER_A, ANALYSIS_1);
  });
});

describe("GET /api/projects/:id/findings", () => {
  it("defaults to the latest done analysis, sorted severity, path, line", async () => {
    const response = await getFindings(request("GET", `/api/projects/${PROJECT_A}/findings`), ctx(PROJECT_A));
    const data = findingsResponseSchema.parse((await body(response)).data);
    expect(data.analysisId).toBe(ANALYSIS_1);
    expect(data.findings.map((f) => `${f.severity}:${f.filePath}:${f.line}`)).toEqual([
      "high:a.ts:null",
      "high:a.ts:2",
      "high:b.ts:9",
      "low:settings.py:3",
    ]);
  });

  it("?analysisId selects a specific analysis of this project (also failed)", async () => {
    const response = await getFindings(request("GET", `/api/projects/${PROJECT_A}/findings?analysisId=${ANALYSIS_2}`), ctx(PROJECT_A));
    const data = findingsResponseSchema.parse((await body(response)).data);
    expect(data.analysisId).toBe(ANALYSIS_2);
    expect(data.findings).toHaveLength(1);
  });

  it("?analysisId of another user or project → 404", async () => {
    const other = await getFindings(request("GET", `/api/projects/${PROJECT_A}/findings?analysisId=${ANALYSIS_B}`), ctx(PROJECT_A));
    expect(other.status).toBe(404);
    const wrongProject = await getFindings(request("GET", `/?analysisId=${ANALYSIS_1}`), ctx(PROJECT_A2));
    expect(wrongProject.status).toBe(404);
  });

  it("malformed analysisId → 400", async () => {
    const response = await getFindings(request("GET", "/?analysisId=x"), ctx(PROJECT_A));
    expect(response.status).toBe(400);
  });

  it("no done analysis → { analysisId: null, findings: [] }", async () => {
    state.tables.analyses = [analysisRow({ status: "failed" })];
    const response = await getFindings(request("GET", "/"), ctx(PROJECT_A));
    expect((await body(response)).data).toEqual({ analysisId: null, findings: [] });
  });
});

describe("GET /api/projects/:id/recommendations", () => {
  it("sorted confidence desc, then title; flowId null", async () => {
    const response = await getRecommendations(request("GET", "/"), ctx(PROJECT_A));
    const data = recommendationsResponseSchema.parse((await body(response)).data);
    expect(data.recommendations.map((r) => r.title)).toEqual(["Top", "Alpha", "Beta"]);
    expect(data.recommendations[0]).toMatchObject({ flowId: null, nodeTypes: ["n8n-nodes-base.webhook"], rationale: "Orders arrive by webhook." });
  });

  it("another user's project → 404", async () => {
    m.getUser.mockResolvedValue({ data: { user: { id: USER_B, email: "b@example.com" } }, error: null });
    expect((await getRecommendations(request("GET", "/"), ctx(PROJECT_A))).status).toBe(404);
  });
});
