// @vitest-environment node
/**
 * GET /api/projects/:id analysis summaries carry `recommendationCount`
 * (Phase 2d, D-36 (b)): a count only for `done` with no error code, null
 * otherwise; one recommendations query for all listed analyses, scoped to
 * the user.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tablesFrom, type Tables } from "./helpers/fake-tables";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const analysisId = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, "0")}`;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  froms: [] as string[],
  getUser: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ APP_URL: "https://app.example.com" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => state.getUser?.() },
    from: (table: string) => {
      state.froms.push(table);
      return tablesFrom(state.tables as Tables)(table);
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/server/rate-limit", () => ({
  RATE_LIMITS: { api: 120, heavy: 10, auth: 20, webhook: 60 },
  enforceUserLimit: vi.fn(async () => undefined),
  enforceIpLimit: vi.fn(async () => undefined),
}));
vi.mock("@/server/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { GET as getProject } from "@/app/api/projects/[id]/route";
import { projectDetailSchema } from "@/schemas/project";

const projectRow = {
  id: PROJECT_A,
  user_id: USER_A,
  installation_id: null,
  repo_full_name: "octo/site",
  repo_id: 101,
  default_branch: "main",
  branch: "main",
  status: "valid",
  invalid_reason: null,
  detected_kind: "website",
  last_commit_sha: null,
  stale: false,
  created_at: "2026-11-12T10:00:00+00:00",
};

function analysis(n: number, status: string, errorCode: string | null, userId = USER_A) {
  return {
    id: analysisId(n),
    project_id: PROJECT_A,
    user_id: userId,
    status,
    commit_sha: null,
    error_code: errorCode,
    started_at: `2026-11-20T10:${String(n).padStart(2, "0")}:00+00:00`,
    finished_at: null,
  };
}

function recs(n: number, count: number, userId = USER_A) {
  return Array.from({ length: count }, (_, i) => ({
    id: `55555555-5555-4555-8555-5555555555${n}${i}`,
    analysis_id: analysisId(n),
    user_id: userId,
  }));
}

async function fetchDetail() {
  const response = await getProject(new Request(`https://app.example.com/api/projects/${PROJECT_A}`), {
    params: Promise.resolve({ id: PROJECT_A }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: unknown };
  return projectDetailSchema.parse(body.data);
}

const countOf = (detail: Awaited<ReturnType<typeof fetchDetail>>, n: number) =>
  detail.analyses.find((a) => a.id === analysisId(n))?.recommendationCount;

beforeEach(() => {
  state.froms.length = 0;
  state.getUser = async () => ({ data: { user: { id: USER_A, email: "a@example.com" } }, error: null });
  state.tables = { projects: [projectRow], analyses: [], recommendations: [] };
});

describe("GET /api/projects/:id recommendationCount (D-36 (b))", () => {
  it("counts done analyses with no error code; null for every other state", async () => {
    state.tables.analyses = [
      analysis(1, "done", null),
      analysis(2, "done", null),
      analysis(3, "done", "AI_DISABLED"),
      analysis(4, "failed", "AI_UNAVAILABLE"),
      analysis(5, "rejected", "PROJECT_INVALID"),
      analysis(6, "analyzing", null),
      analysis(7, "queued", null),
    ];
    state.tables.recommendations = [...recs(1, 3), ...recs(3, 2), ...recs(4, 1), ...recs(6, 1)];
    const detail = await fetchDetail();
    expect(countOf(detail, 1)).toBe(3);
    expect(countOf(detail, 2)).toBe(0);
    for (const n of [3, 4, 5, 6, 7]) expect(countOf(detail, n)).toBeNull();
  });

  it("runs one recommendations query for several analyses", async () => {
    state.tables.analyses = [1, 2, 3, 4].map((n) => analysis(n, "done", null));
    state.tables.recommendations = [...recs(1, 1), ...recs(2, 2), ...recs(3, 3), ...recs(4, 8)];
    const detail = await fetchDetail();
    expect(state.froms.filter((table) => table === "recommendations")).toHaveLength(1);
    expect([1, 2, 3, 4].map((n) => countOf(detail, n))).toEqual([1, 2, 3, 8]);
  });

  it("skips the count query when no analysis can have a count", async () => {
    state.tables.analyses = [analysis(1, "failed", "INTERNAL")];
    const detail = await fetchDetail();
    expect(state.froms).not.toContain("recommendations");
    expect(countOf(detail, 1)).toBeNull();
  });

  it("never counts another user's rows", async () => {
    state.tables.analyses = [analysis(1, "done", null)];
    state.tables.recommendations = [...recs(1, 2), ...recs(1, 5, USER_B).map((row, i) => ({ ...row, id: `66666666-6666-4666-8666-66666666666${i}` }))];
    const detail = await fetchDetail();
    expect(countOf(detail, 1)).toBe(2);
  });
});
