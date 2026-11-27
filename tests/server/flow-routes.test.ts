// @vitest-environment node
/**
 * Phase 3b routes (contract section 6, D-41, D-50, D-59):
 * POST /api/recommendations/generate (check order, all-or-nothing, daily cap
 * consumed last), GET /api/flows (scoped, newest first, at most 20),
 * GET /api/flows/:id (ownership, view built from the stored spec with the
 * compiler layout, poll kick), GET /api/flows/:id/export (attachment headers,
 * body = stored JSON, EXPORT_NOT_VALID from the validator and from
 * assertExportSafe), and GET /api/projects/:id/recommendations deriving
 * status / flowId from the newest flow with one flows query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compileFlow, layoutFlow } from "@/lib/compiler";
import { deriveFlowSpecDraft } from "@/lib/generation/fake";
import { checkFlowSpec } from "@/lib/flowspec";
import { CATALOG_VERSION, N8N_VERSION } from "@/lib/n8n-catalog/version";
import { flowSpecDraftSchema, type FlowSpec } from "@/schemas/flowspec";

import { tablesFrom, type Tables } from "./helpers/fake-tables";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "33333333-3333-4333-8333-33333333333b";
const ANALYSIS_1 = "44444444-4444-4444-8444-444444444441";
const ANALYSIS_2 = "44444444-4444-4444-8444-444444444442";
const ANALYSIS_B = "44444444-4444-4444-8444-44444444444b";
const REC_1 = "e0000000-0000-4000-8000-000000000001";
const REC_2 = "e0000000-0000-4000-8000-000000000002";
const REC_3 = "e0000000-0000-4000-8000-000000000003";
const REC_4 = "e0000000-0000-4000-8000-000000000004";
const REC_OTHER_ANALYSIS = "e0000000-0000-4000-8000-000000000005";
const REC_B = "e0000000-0000-4000-8000-00000000000b";
const FLOW_READY = "f1000000-0000-4000-8000-000000000001";
const FLOW_GEN = "f1000000-0000-4000-8000-000000000002";
const FLOW_B = "f1000000-0000-4000-8000-00000000000b";
const NEW_FLOW_1 = "f2000000-0000-4000-8000-000000000001";
const NEW_FLOW_2 = "f2000000-0000-4000-8000-000000000002";
const HEAD = "c".repeat(40);

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  order: [] as string[],
  selects: [] as { table: string; columns: string }[],
  forceValidatorOk: false,
}));

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  createFlowsWithJobs: vi.fn(),
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
  logInfo: vi.fn(),
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
vi.mock("@/server/log", () => ({ logServerInfo: m.logInfo, logServerError: vi.fn() }));
vi.mock("@/server/jobs/trigger", () => ({
  scheduleWorkerTrigger: m.scheduleWorkerTrigger,
  pollKick: m.pollKick,
  expireStaleJobs: m.expireStaleJobs,
}));
vi.mock("@/server/analyses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/analyses")>()),
  setProjectRepoId: m.setProjectRepoId,
}));
vi.mock("@/server/flows/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/flows/data")>()),
  createFlowsWithJobs: m.createFlowsWithJobs,
}));
vi.mock("@/lib/validator", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/validator")>();
  return {
    ...real,
    validateWorkflow: (workflow: unknown, checklist: unknown) =>
      state.forceValidatorOk ? { ok: true } : real.validateWorkflow(workflow, checklist),
  };
});

import { GET as exportFlow } from "@/app/api/flows/[id]/export/route";
import { GET as getFlow } from "@/app/api/flows/[id]/route";
import { GET as listFlows } from "@/app/api/flows/route";
import { GET as getRecommendations } from "@/app/api/projects/[id]/recommendations/route";
import { POST as generate } from "@/app/api/recommendations/generate/route";
import { exportSlug } from "@/server/flows/export";
import { flowDetailSchema, flowsResponseSchema, generateResponseSchema } from "@/schemas/flow";
import { recommendationsResponseSchema } from "@/schemas/recommendation";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function post(body: unknown, origin?: string): Request {
  return new Request("https://app.example.com/api/recommendations/generate", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin === undefined ? {} : { origin }) },
    body: JSON.stringify(body),
  });
}
const get = (path: string) => new Request(`https://app.example.com${path}`);

async function json(response: Response) {
  return (await response.json()) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}

function readySpec(): FlowSpec {
  const checked = checkFlowSpec(flowSpecDraftSchema.parse(deriveFlowSpecDraft('<recommendation>\n{"trigger_kind":"webhook"}\n</recommendation>')));
  if (!checked.ok) throw new Error("fixture spec must pass");
  return checked.spec;
}

const SPEC = readySpec();
const COMPILED = compileFlow(SPEC);

const rec = (id: string, analysisId: string, userId = USER_A, title = "Alert Slack on orders") => ({
  id,
  analysis_id: analysisId,
  user_id: userId,
  title,
  description: "Post to Slack when an order arrives.",
  trigger_kind: "webhook",
  confidence: 0.8,
  source_files: ["src/orders.ts"],
  required_credentials: ["Slack"],
  risk_level: "low",
  node_types: ["n8n-nodes-base.webhook"],
  rationale: "Orders arrive by webhook.",
  estimated_tokens: 4100,
  status: "new",
});

const flow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_A,
  recommendation_id: REC_1,
  name: SPEC.name,
  status: "ready",
  error_code: null,
  created_at: "2026-11-27T10:00:00+00:00",
  flow_spec: SPEC,
  n8n_json: structuredClone(COMPILED.workflow),
  setup_checklist: structuredClone(COMPILED.checklist),
  catalog_version: CATALOG_VERSION,
  n8n_version: N8N_VERSION,
  ...overrides,
});

function seed(options: { syncedAt?: string | null; lastCommit?: string | null; installation?: string | null; repoName?: string } = {}) {
  state.tables = {
    github_installations: [
      {
        id: INSTALL_A,
        user_id: USER_A,
        installation_id: 4242,
        repos_synced_at: options.syncedAt === undefined ? new Date().toISOString() : options.syncedAt,
      },
    ],
    github_installation_repos: [
      {
        user_id: USER_A,
        installation_id: INSTALL_A,
        repo_id: 101,
        repo_full_name: options.repoName ?? "octo/site",
        private: true,
        default_branch: "main",
      },
    ],
    projects: [
      {
        id: PROJECT_A,
        user_id: USER_A,
        installation_id: options.installation === undefined ? INSTALL_A : options.installation,
        repo_full_name: "octo/site",
        repo_id: 101,
        default_branch: "main",
        branch: "main",
        status: "valid",
        invalid_reason: null,
        detected_kind: "website",
        last_commit_sha: options.lastCommit === undefined ? HEAD : options.lastCommit,
        stale: false,
        created_at: "2026-11-12T10:00:00+00:00",
      },
      {
        id: PROJECT_B,
        user_id: USER_B,
        installation_id: null,
        repo_full_name: "evil/repo",
        repo_id: 999,
        default_branch: "main",
        branch: "main",
        status: "valid",
        invalid_reason: null,
        detected_kind: "app",
        last_commit_sha: HEAD,
        stale: false,
        created_at: "2026-11-12T10:00:00+00:00",
      },
    ],
    analyses: [
      { id: ANALYSIS_1, project_id: PROJECT_A, user_id: USER_A, commit_sha: HEAD, status: "done" },
      { id: ANALYSIS_2, project_id: PROJECT_A, user_id: USER_A, commit_sha: HEAD, status: "done" },
      { id: ANALYSIS_B, project_id: PROJECT_B, user_id: USER_B, commit_sha: HEAD, status: "done" },
    ],
    recommendations: [
      rec(REC_1, ANALYSIS_1, USER_A, "Top"),
      rec(REC_2, ANALYSIS_1, USER_A, "Second"),
      rec(REC_3, ANALYSIS_1, USER_A, "Third"),
      rec(REC_4, ANALYSIS_1, USER_A, "Fourth"),
      rec(REC_OTHER_ANALYSIS, ANALYSIS_2),
      rec(REC_B, ANALYSIS_B, USER_B),
    ],
    flows: [],
    jobs: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  state.order = [];
  state.selects = [];
  state.forceValidatorOk = false;
  seed();
  m.getUser.mockResolvedValue({ data: { user: { id: USER_A, email: "a@example.com" } }, error: null });
  m.createFlowsWithJobs.mockImplementation(async (input: { recommendations: { id: string }[] }) => {
    state.order.push("insert");
    return input.recommendations.map((_, i) => (i === 0 ? NEW_FLOW_1 : NEW_FLOW_2));
  });
  m.dailyHit.mockImplementation(async () => {
    state.order.push("dailyCap");
    return true;
  });
});

describe("POST /api/recommendations/generate", () => {
  it("202 { flowIds } in request order; flows named by title; trigger; one audit per flow; limit route generate 10/min", async () => {
    const response = await generate(post({ recommendationIds: [REC_2, REC_1] }, "https://app.example.com"), ctx(""));
    expect(response.status).toBe(202);
    const body = await json(response);
    expect(generateResponseSchema.parse(body.data)).toEqual({ flowIds: [NEW_FLOW_1, NEW_FLOW_2] });
    expect(m.createFlowsWithJobs).toHaveBeenCalledWith({
      userId: USER_A,
      recommendations: [
        { id: REC_2, title: "Second" },
        { id: REC_1, title: "Top" },
      ],
    });
    expect(m.scheduleWorkerTrigger).toHaveBeenCalledWith({ userId: USER_A });
    expect(m.audit.mock.calls).toEqual([
      [USER_A, "flow.generate", NEW_FLOW_1],
      [USER_A, "flow.generate", NEW_FLOW_2],
    ]);
    expect(m.enforceUserLimit).toHaveBeenCalledWith("generate", USER_A, 10);
    // The daily cap counts each recommendation.
    expect(m.dailyHit).toHaveBeenCalledTimes(2);
  });

  it("check order: recommendations → analysis → project → repo access → expire → active flows → daily cap → insert", async () => {
    await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    const relevant = state.order.filter((step) =>
      [
        "select:recommendations",
        "select:analyses",
        "select:projects",
        "select:github_installations",
        "select:github_installation_repos",
        "expire",
        "select:flows",
        "dailyCap",
        "insert",
      ].includes(step),
    );
    expect(relevant).toEqual([
      "select:recommendations",
      "select:analyses",
      "select:projects",
      "select:github_installations",
      "select:github_installation_repos",
      "expire",
      "select:flows",
      "dailyCap",
      "insert",
    ]);
  });

  it("unauthenticated → 401; cross-origin → 403; both before any read", async () => {
    m.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await generate(post({ recommendationIds: [REC_1] }), ctx(""))).status).toBe(401);
    const forbidden = await generate(post({ recommendationIds: [REC_1] }, "https://evil.example"), ctx(""));
    expect(forbidden.status).toBe(403);
    expect(state.order.filter((step) => step.startsWith("select:"))).toEqual([]);
  });

  it.each([
    [{ recommendationIds: [] }],
    [{ recommendationIds: [REC_1, REC_1] }],
    [{ recommendationIds: ["not-a-uuid"] }],
    [{ recommendationIds: Array.from({ length: 9 }, (_, i) => `e0000000-0000-4000-8000-00000000010${i}`) }],
    [{ recommendationIds: [REC_1], allowStale: "yes" }],
    [{ recommendationIds: [REC_1], extra: 1, allowStale: 1 }],
  ])("invalid body → 400 VALIDATION_ERROR (%#)", async (payload) => {
    const response = await generate(post(payload), ctx(""));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.code).toBe("VALIDATION_ERROR");
    expect(m.dailyHit).not.toHaveBeenCalled();
  });

  it("another user's recommendation → NOT_FOUND, nothing else read or consumed", async () => {
    const response = await generate(post({ recommendationIds: [REC_1, REC_B] }), ctx(""));
    expect(response.status).toBe(404);
    expect(state.order).not.toContain("select:github_installations");
    expect(m.dailyHit).not.toHaveBeenCalled();
    expect(m.createFlowsWithJobs).not.toHaveBeenCalled();
  });

  it("recommendations from two analyses → VALIDATION_ERROR", async () => {
    const response = await generate(post({ recommendationIds: [REC_1, REC_OTHER_ANALYSIS] }), ctx(""));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.message).toBe("Choose recommendations from one analysis.");
  });

  it("project without installation → VALIDATION_ERROR reconnect, before repo access", async () => {
    seed({ installation: null });
    const response = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.message).toBe("Reconnect GitHub to generate flows");
    expect(state.order).not.toContain("select:github_installations");
  });

  it("stale repo access set → GITHUB_REFRESH_REQUIRED; renamed repo (name mismatch) → GITHUB_REFRESH_REQUIRED", async () => {
    seed({ syncedAt: "2026-01-01T00:00:00Z" });
    const stale = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect(stale.status).toBe(403);
    expect((await json(stale)).error?.code).toBe("GITHUB_REFRESH_REQUIRED");
    seed({ repoName: "octo/renamed" });
    const renamed = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect((await json(renamed)).error?.code).toBe("GITHUB_REFRESH_REQUIRED");
    expect(m.dailyHit).not.toHaveBeenCalled();
  });

  it("a generating or ready flow already exists → VALIDATION_ERROR; a failed one does not block", async () => {
    state.tables.flows = [flow(FLOW_GEN, { recommendation_id: REC_1, status: "generating" })];
    const response = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect(response.status).toBe(400);
    expect((await json(response)).error?.message).toBe("A flow already exists for this recommendation.");
    expect(m.dailyHit).not.toHaveBeenCalled();

    state.tables.flows = [flow(FLOW_GEN, { recommendation_id: REC_1, status: "failed" })];
    expect((await generate(post({ recommendationIds: [REC_1] }), ctx(""))).status).toBe(202);
  });

  it("analysis commit differs from the project head → 409 PROJECT_STALE_ANALYSIS unless allowStale; cap not consumed", async () => {
    seed({ lastCommit: "d".repeat(40) });
    const stale = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect(stale.status).toBe(409);
    expect((await json(stale)).error?.code).toBe("PROJECT_STALE_ANALYSIS");
    expect(m.dailyHit).not.toHaveBeenCalled();
    const allowed = await generate(post({ recommendationIds: [REC_1], allowStale: true }), ctx(""));
    expect(allowed.status).toBe(202);
    const notAllowed = await generate(post({ recommendationIds: [REC_1], allowStale: false }), ctx(""));
    expect(notAllowed.status).toBe(409);
  });

  it("daily cap reached → 429 DAILY_CAP_REACHED with the reset message, nothing inserted", async () => {
    m.dailyHit.mockResolvedValue(false);
    const response = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect(response.status).toBe(429);
    expect(await json(response)).toEqual({
      ok: false,
      error: { code: "DAILY_CAP_REACHED", message: "Daily limit of 30 generations reached. It resets at 00:00 UTC." },
    });
    expect(m.createFlowsWithJobs).not.toHaveBeenCalled();
    expect(m.scheduleWorkerTrigger).not.toHaveBeenCalled();
  });

  it("a racing insert rejected by the partial unique index → the 'already exists' error, no trigger or audit", async () => {
    const { ApiError } = await import("@/server/http");
    m.createFlowsWithJobs.mockRejectedValueOnce(new ApiError("VALIDATION_ERROR", "A flow already exists for this recommendation."));
    const response = await generate(post({ recommendationIds: [REC_1] }), ctx(""));
    expect(response.status).toBe(400);
    expect(m.scheduleWorkerTrigger).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("GET /api/flows", () => {
  it("returns only the user's flows, newest first, at most 20, with links", async () => {
    state.tables.flows = [
      ...Array.from({ length: 25 }, (_, i) =>
        flow(`f3000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, {
          created_at: `2026-11-27T10:${String(i).padStart(2, "0")}:00+00:00`,
          name: `Flow ${i}`,
          status: i % 3 === 0 ? "failed" : "ready",
          error_code: i % 3 === 0 ? "GENERATION_EXHAUSTED" : null,
        }),
      ),
      flow(FLOW_B, { user_id: USER_B, recommendation_id: REC_B, created_at: "2026-11-28T10:00:00+00:00" }),
    ];
    const response = await listFlows(get("/api/flows"), ctx(""));
    expect(response.status).toBe(200);
    const { flows } = flowsResponseSchema.parse((await json(response)).data);
    expect(flows).toHaveLength(20);
    expect(flows.map((item) => item.id)).not.toContain(FLOW_B);
    expect(flows[0]).toMatchObject({
      name: "Flow 24",
      analysisId: ANALYSIS_1,
      projectId: PROJECT_A,
      repoFullName: "octo/site",
      recommendationId: REC_1,
    });
    expect(flows.find((item) => item.name === "Flow 21")?.errorCode).toBe("GENERATION_EXHAUSTED");
    // No heavy json columns on the list query.
    const flowSelect = state.selects.find((entry) => entry.table === "flows");
    expect(flowSelect?.columns).not.toContain("n8n_json");
    expect(flowSelect?.columns).not.toContain("flow_spec");
  });
});

describe("GET /api/flows/:id", () => {
  it("ready flow → FlowDetail built from the stored spec; positions equal the compiler layout; no raw spec / tests / n8n_json", async () => {
    state.tables.flows = [flow(FLOW_READY)];
    const response = await getFlow(get(`/api/flows/${FLOW_READY}`), ctx(FLOW_READY));
    expect(response.status).toBe(200);
    const raw = (await json(response)).data as Record<string, unknown>;
    for (const key of ["flowSpec", "flow_spec", "tests", "n8nJson", "n8n_json"]) expect(raw).not.toHaveProperty(key);
    expect(JSON.stringify(raw)).not.toContain("Happy path");
    const detail = flowDetailSchema.parse(raw);
    expect(detail).toMatchObject({
      id: FLOW_READY,
      recommendationId: REC_1,
      analysisId: ANALYSIS_1,
      projectId: PROJECT_A,
      repoFullName: "octo/site",
      description: SPEC.description,
      status: "ready",
      errorCode: null,
      n8nVersion: N8N_VERSION,
      catalogVersion: CATALOG_VERSION,
      checklist: COMPILED.checklist,
      latestTestRun: null,
    });
    const layout = layoutFlow(SPEC.nodes, SPEC.edges);
    expect(detail.nodes.map((node) => [node.key, node.position])).toEqual(
      SPEC.nodes.map((node) => [node.key, layout.get(node.key)]),
    );
    // The canvas positions match the export.
    expect(detail.nodes.map((node) => [node.position.x, node.position.y])).toEqual(
      COMPILED.workflow.nodes.map((node) => node.position),
    );
    expect(detail.nodes[2]).toMatchObject({ nodeType: "n8n-nodes-base.slack", tier: 2, credential: "Slack", outputs: 1, outputLabels: [""] });
    expect(detail.edges.map((edge) => edge.id)).toEqual(["incoming:0->summary:0", "summary:0->notify:0"]);
    expect(m.pollKick).not.toHaveBeenCalled();
  });

  it("another user's flow or a malformed id → NOT_FOUND", async () => {
    state.tables.flows = [flow(FLOW_B, { user_id: USER_B, recommendation_id: REC_B })];
    expect((await getFlow(get(`/api/flows/${FLOW_B}`), ctx(FLOW_B))).status).toBe(404);
    expect((await getFlow(get("/api/flows/x"), ctx("x"))).status).toBe(404);
  });

  it("generating flow → poll kick for its generate job; no nodes or checklist; expired → re-read", async () => {
    state.tables.flows = [
      flow(FLOW_GEN, { status: "generating", flow_spec: null, n8n_json: null, setup_checklist: null, catalog_version: null, n8n_version: null }),
    ];
    const first = flowDetailSchema.parse((await json(await getFlow(get(`/api/flows/${FLOW_GEN}`), ctx(FLOW_GEN)))).data);
    expect(m.pollKick).toHaveBeenCalledWith(USER_A, FLOW_GEN, "generate");
    expect(first).toMatchObject({ status: "generating", nodes: [], edges: [], checklist: null, description: null });

    m.pollKick.mockImplementationOnce(async () => {
      const row = state.tables.flows?.[0];
      if (row !== undefined) Object.assign(row, { status: "failed", error_code: "JOB_EXPIRED" });
      return "expired";
    });
    const second = flowDetailSchema.parse((await json(await getFlow(get(`/api/flows/${FLOW_GEN}`), ctx(FLOW_GEN)))).data);
    expect(second).toMatchObject({ status: "failed", errorCode: "JOB_EXPIRED" });
  });
});

describe("GET /api/flows/:id/export", () => {
  it("attachment headers; body equals the stored JSON pretty-printed; audit flow.export; limit route export 10/min", async () => {
    state.tables.flows = [flow(FLOW_READY, { name: "Team notification" })];
    const response = await exportFlow(get(`/api/flows/${FLOW_READY}/export`), ctx(FLOW_READY));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="team-notification.n8n.json"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await response.text();
    expect(text).toBe(`${JSON.stringify(COMPILED.workflow, null, 2)}\n`);
    expect(JSON.parse(text)).toEqual(COMPILED.workflow);
    expect(m.audit).toHaveBeenCalledWith(USER_A, "flow.export", FLOW_READY);
    expect(m.enforceUserLimit).toHaveBeenCalledWith("export", USER_A, 10);
  });

  it("not ready → 409 EXPORT_NOT_VALID (envelope)", async () => {
    state.tables.flows = [flow(FLOW_GEN, { status: "generating", n8n_json: null })];
    const response = await exportFlow(get(`/api/flows/${FLOW_GEN}/export`), ctx(FLOW_GEN));
    expect(response.status).toBe(409);
    expect((await json(response)).error?.code).toBe("EXPORT_NOT_VALID");
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("stored JSON that fails validateWorkflow (a planted literal recipient) → EXPORT_NOT_VALID, logged by rule only", async () => {
    const tampered = structuredClone(COMPILED.workflow) as unknown as { nodes: { type: string; parameters: Record<string, unknown> }[] };
    const slack = tampered.nodes.find((node) => node.type === "n8n-nodes-base.slack");
    if (slack === undefined) throw new Error("fixture");
    slack.parameters.channelId = { __rl: true, mode: "id", value: "C0LITERAL1" };
    state.tables.flows = [flow(FLOW_READY, { n8n_json: tampered })];
    const response = await exportFlow(get(`/api/flows/${FLOW_READY}/export`), ctx(FLOW_READY));
    expect(response.status).toBe(409);
    expect((await json(response)).error?.code).toBe("EXPORT_NOT_VALID");
    const logged = JSON.stringify(m.logInfo.mock.calls);
    expect(logged).toContain("EXPORT_NOT_VALID");
    expect(logged).not.toContain("C0LITERAL1");
    expect(m.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["a planted sk-ant key", (workflow: { nodes: { type: string; parameters: Record<string, unknown> }[] }) => {
      const slack = workflow.nodes.find((node) => node.type === "n8n-nodes-base.slack");
      if (slack !== undefined) slack.parameters.text = `key sk-ant-api03-${"Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3".repeat(2)}`;
    }],
    ["an added code node", (workflow: { nodes: Record<string, unknown>[] }) => {
      workflow.nodes.push({ id: "x", name: "Run Code", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: "return []" } });
    }],
  ])("%s → EXPORT_NOT_VALID with the real validator, and from assertExportSafe alone", async (_label, mutate) => {
    const tampered = structuredClone(COMPILED.workflow) as unknown as { nodes: { type: string; parameters: Record<string, unknown> }[] };
    (mutate as (w: typeof tampered) => void)(tampered);
    state.tables.flows = [flow(FLOW_READY, { n8n_json: tampered })];
    const real = await exportFlow(get(`/api/flows/${FLOW_READY}/export`), ctx(FLOW_READY));
    expect(real.status).toBe(409);
    // With the validator forced to pass, assertExportSafe still refuses it.
    state.forceValidatorOk = true;
    const alone = await exportFlow(get(`/api/flows/${FLOW_READY}/export`), ctx(FLOW_READY));
    expect(alone.status).toBe(409);
    expect((await json(alone)).error?.code).toBe("EXPORT_NOT_VALID");
    expect(m.logInfo.mock.calls.some((call) => JSON.stringify(call).includes('"rule"'))).toBe(true);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("another user's flow → NOT_FOUND", async () => {
    state.tables.flows = [flow(FLOW_B, { user_id: USER_B, recommendation_id: REC_B })];
    expect((await exportFlow(get(`/api/flows/${FLOW_B}/export`), ctx(FLOW_B))).status).toBe(404);
  });

  it("slug rules", () => {
    expect(exportSlug("Team Notification!")).toBe("team-notification");
    expect(exportSlug("  ")).toBe("flow");
    expect(exportSlug('a"b\r\nc')).toBe("a-b-c");
    expect(exportSlug(`${"ab ".repeat(40)}`).length).toBeLessThanOrEqual(60);
    expect(exportSlug(`${"ab ".repeat(40)}`).endsWith("-")).toBe(false);
  });
});

describe("GET /api/projects/:id/recommendations derives status from the newest flow (D-41)", () => {
  it("all four cases with one flows query", async () => {
    state.tables.analyses = [{ id: ANALYSIS_1, project_id: PROJECT_A, user_id: USER_A, status: "done", finished_at: "2026-11-27T10:00:00+00:00", started_at: "2026-11-27T09:00:00+00:00" }];
    state.tables.flows = [
      flow("f4000000-0000-4000-8000-000000000002", { recommendation_id: REC_2, status: "generating", created_at: "2026-11-27T11:00:00+00:00" }),
      flow("f4000000-0000-4000-8000-000000000031", { recommendation_id: REC_3, status: "failed", created_at: "2026-11-27T09:00:00+00:00" }),
      flow("f4000000-0000-4000-8000-000000000032", { recommendation_id: REC_3, status: "ready", created_at: "2026-11-27T10:00:00+00:00" }),
      flow("f4000000-0000-4000-8000-000000000042", { recommendation_id: REC_4, status: "failed", created_at: "2026-11-27T12:00:00+00:00" }),
      flow("f4000000-0000-4000-8000-000000000041", { recommendation_id: REC_4, status: "ready", created_at: "2026-11-27T08:00:00+00:00" }),
      flow(FLOW_B, { user_id: USER_B, recommendation_id: REC_1, status: "ready", created_at: "2026-11-28T08:00:00+00:00" }),
    ];
    const response = await getRecommendations(get(`/api/projects/${PROJECT_A}/recommendations`), ctx(PROJECT_A));
    expect(response.status).toBe(200);
    const data = recommendationsResponseSchema.parse((await json(response)).data);
    const byId = new Map(data.recommendations.map((item) => [item.id, item]));
    expect(byId.get(REC_1)).toMatchObject({ status: "new", flowId: null });
    expect(byId.get(REC_2)).toMatchObject({ status: "selected", flowId: "f4000000-0000-4000-8000-000000000002" });
    expect(byId.get(REC_3)).toMatchObject({ status: "generated", flowId: "f4000000-0000-4000-8000-000000000032" });
    expect(byId.get(REC_4)).toMatchObject({ status: "new", flowId: "f4000000-0000-4000-8000-000000000042" });
    expect(state.order.filter((step) => step === "select:flows")).toHaveLength(1);
  });
});
