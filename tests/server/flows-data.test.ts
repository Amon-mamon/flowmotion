// @vitest-environment node
/**
 * Phase 3b `createFlowsWithJobs` (contract section 6): one flows insert,
 * then one jobs insert; a racing insert rejected by the partial unique index
 * deletes this request's rows and becomes the "already exists" error; a
 * failed job insert removes the flows it created.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  log: [] as { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[],
  flowsInsertError: null as { code: string } | null,
  jobsInsertError: null as { code: string } | null,
}));

function builder(table: string) {
  const entry = { table, op: "", payload: undefined as unknown, filters: [] as [string, unknown][] };
  const chain = {
    insert(payload: unknown) {
      entry.op = "insert";
      entry.payload = payload;
      calls.log.push(entry);
      const error = table === "flows" ? calls.flowsInsertError : calls.jobsInsertError;
      return Promise.resolve({ data: null, error });
    },
    delete() {
      entry.op = "delete";
      calls.log.push(entry);
      return chain;
    },
    eq(column: string, value: unknown) {
      entry.filters.push([column, value]);
      return chain;
    },
    in(column: string, value: unknown) {
      entry.filters.push([column, value]);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => builder(table) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { createFlowsWithJobs } from "@/server/flows/data";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECS = [
  { id: "e0000000-0000-4000-8000-000000000001", title: "One" },
  { id: "e0000000-0000-4000-8000-000000000002", title: "Two" },
];

beforeEach(() => {
  calls.log = [];
  calls.flowsInsertError = null;
  calls.jobsInsertError = null;
});

describe("createFlowsWithJobs", () => {
  it("inserts generating flows (named by title) in one statement, then one generate job each at context", async () => {
    const ids = await createFlowsWithJobs({ userId: USER, recommendations: RECS });
    expect(ids).toHaveLength(2);
    const [flows, jobs] = calls.log;
    expect(flows).toMatchObject({ table: "flows", op: "insert" });
    expect(flows?.payload).toEqual([
      { id: ids[0], user_id: USER, recommendation_id: RECS[0]?.id, name: "One", status: "generating" },
      { id: ids[1], user_id: USER, recommendation_id: RECS[1]?.id, name: "Two", status: "generating" },
    ]);
    expect(jobs?.payload).toEqual(
      ids.map((id) => ({ user_id: USER, kind: "generate", ref_id: id, status: "queued", step: "context" })),
    );
  });

  it("a unique violation (racing insert) deletes this request's rows and returns the 'already exists' error", async () => {
    calls.flowsInsertError = { code: "23505" };
    await expect(createFlowsWithJobs({ userId: USER, recommendations: RECS })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "A flow already exists for this recommendation.",
    });
    const cleanup = calls.log.find((entry) => entry.table === "flows" && entry.op === "delete");
    const flowsInsert = calls.log.find((entry) => entry.table === "flows" && entry.op === "insert");
    const insertedIds = (flowsInsert?.payload as { id: string }[]).map((row) => row.id);
    expect(cleanup?.filters).toEqual([
      ["user_id", USER],
      ["id", insertedIds],
    ]);
    expect(calls.log.some((entry) => entry.table === "jobs")).toBe(false);
  });

  it("a failed job insert removes the jobs and flows of this request", async () => {
    calls.jobsInsertError = { code: "XX000" };
    await expect(createFlowsWithJobs({ userId: USER, recommendations: RECS })).rejects.toThrow("jobs insert failed");
    expect(calls.log.filter((entry) => entry.op === "delete").map((entry) => entry.table)).toEqual(["jobs", "flows"]);
  });
});
