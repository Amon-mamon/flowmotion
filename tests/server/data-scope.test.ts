// @vitest-environment node
/**
 * Data-access scoping: every user-facing read/write filters by user_id, the
 * project delete is one atomic `delete_project` RPC (review R1-1), and the
 * duplicate-repo unique violation maps to the contract message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [method: string, args: unknown[]];

class FakeQuery {
  readonly calls: Call[] = [];
  constructor(private readonly result: { data: unknown; error: { code?: string } | null }) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push([method, args]);
    return this;
  }
  select(...args: unknown[]) { return this.record("select", args); }
  eq(...args: unknown[]) { return this.record("eq", args); }
  in(...args: unknown[]) { return this.record("in", args); }
  order(...args: unknown[]) { return this.record("order", args); }
  insert(...args: unknown[]) { return this.record("insert", args); }
  upsert(...args: unknown[]) { return this.record("upsert", args); }
  update(...args: unknown[]) { return this.record("update", args); }
  delete(...args: unknown[]) { return this.record("delete", args); }
  maybeSingle() { return this.record("maybeSingle", []); }
  single() { return this.record("single", []); }
  then<T>(resolve: (value: { data: unknown; error: { code?: string } | null }) => T) {
    return Promise.resolve(this.result).then(resolve);
  }
}

const h = vi.hoisted(() => ({
  next: { data: null as unknown, error: null as { code?: string } | null },
  queries: [] as { table: string; query: unknown }[],
  rpc: vi.fn(),
}));

function makeClient() {
  return {
    from(table: string) {
      const query = new FakeQuery({ data: h.next.data, error: h.next.error });
      h.queries.push({ table, query });
      return query;
    },
    rpc: h.rpc,
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient() }));

import {
  deleteInstallationForUser,
  getInstallationForUser,
  listInstallationsForUser,
} from "@/server/installations";
import { createProject, deleteProjectForUser, getProjectForUser, listProjectsForUser } from "@/server/projects";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function lastCalls(): Call[] {
  const last = h.queries.at(-1);
  if (last === undefined) throw new Error("no query");
  return (last.query as FakeQuery).calls;
}

beforeEach(() => {
  h.queries.length = 0;
  h.next = { data: null, error: null };
  h.rpc.mockReset();
});

describe("user_id scoping", () => {
  it("installation reads and deletes filter by user_id and id", async () => {
    h.next = { data: [], error: null };
    await listInstallationsForUser(USER);
    expect(lastCalls()).toContainEqual(["eq", ["user_id", USER]]);

    h.next = { data: null, error: null };
    expect(await getInstallationForUser(USER, OTHER_ID)).toBeNull();
    expect(lastCalls()).toContainEqual(["eq", ["user_id", USER]]);
    expect(lastCalls()).toContainEqual(["eq", ["id", OTHER_ID]]);

    h.next = { data: [], error: null };
    await expect(deleteInstallationForUser(USER, OTHER_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(lastCalls()).toContainEqual(["eq", ["user_id", USER]]);
    expect(lastCalls()).toContainEqual(["eq", ["id", OTHER_ID]]);
  });

  it("project reads filter by user_id", async () => {
    h.next = { data: [], error: null };
    await listProjectsForUser(USER);
    expect(lastCalls()).toContainEqual(["eq", ["user_id", USER]]);

    h.next = { data: null, error: null };
    expect(await getProjectForUser(USER, OTHER_ID)).toBeNull();
    expect(lastCalls()).toContainEqual(["eq", ["user_id", USER]]);
    expect(lastCalls()).toContainEqual(["eq", ["id", OTHER_ID]]);
  });
});

describe("deleteProjectForUser (R1-1)", () => {
  it("is one delete_project RPC scoped to the user", async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });
    await expect(deleteProjectForUser(USER, OTHER_ID)).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("delete_project", { p_user_id: USER, p_project_id: OTHER_ID });
    // No multi-step table access outside the transaction.
    expect(h.queries).toHaveLength(0);
  });

  it("maps false (not the user's project) to NOT_FOUND", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    await expect(deleteProjectForUser(USER, OTHER_ID)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("surfaces an RPC error as an internal error (no partial success)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    await expect(deleteProjectForUser(USER, OTHER_ID)).rejects.toThrow("delete_project failed: 40001");
  });
});

describe("createProject", () => {
  it("maps a unique violation to the contract message", async () => {
    h.next = { data: null, error: { code: "23505" } };
    await expect(
      createProject({ userId: USER, installationRowId: OTHER_ID, repoFullName: "octo/site", defaultBranch: "main" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "This repository is already connected" });
    expect(lastCalls()[0]).toEqual([
      "insert",
      [{ user_id: USER, installation_id: OTHER_ID, repo_full_name: "octo/site", default_branch: "main" }],
    ]);
  });
});
