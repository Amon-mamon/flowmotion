// @vitest-environment node
/**
 * RLS cross-user suite (docs/contract.md section 11, Phase 1 item 2; review
 * R1-2, R1-1, R1-7). Runs only against a local `supabase start` stack named by
 * the test-only SUPABASE_TEST_* variables (contract section 10). When any is
 * unset the suite is reported as skipped, never as passed.
 *
 * Write-denial checks are built so they can fail: inserts use complete,
 * constraint-valid rows, updates change a real column to a different value,
 * and the assertion is the privilege error (42501), verified via the admin
 * client that nothing changed.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

if (!configured) {
  console.warn("[rls] skipped: no local Supabase (SUPABASE_TEST_* not set)");
}

/** Postgres insufficient_privilege: the denial we expect, not a constraint error. */
const PERMISSION_DENIED = "42501";

const OWNED_TABLES = [
  "github_installations",
  "projects",
  "analyses",
  "jobs",
  "security_findings",
  "recommendations",
  "flows",
  "flow_test_runs",
  "usage_events",
  "audit_log",
] as const;
type OwnedTable = (typeof OWNED_TABLES)[number];
type Ids = Record<OwnedTable, string>;
type Row = Record<string, unknown>;

/** One real column per table, changed to a value the seed never uses. */
const UPDATE_PROBE: Record<OwnedTable, { column: string; value: unknown }> = {
  github_installations: { column: "account_login", value: "hijacked" },
  projects: { column: "stale", value: true },
  analyses: { column: "progress", value: 99 },
  jobs: { column: "step", value: "hijacked" },
  security_findings: { column: "remediation", value: "hijacked" },
  recommendations: { column: "title", value: "hijacked" },
  flows: { column: "name", value: "hijacked" },
  flow_test_runs: { column: "simulator_version", value: "hijacked" },
  usage_events: { column: "tokens_in", value: 999 },
  audit_log: { column: "action", value: "hijacked" },
};

/**
 * A complete, constraint-valid row for `table` owned by `userId`, whose parent
 * FKs point at that user's existing rows (`parents`). Fresh unique values each call.
 */
function validRow(table: OwnedTable, userId: string, parents: Partial<Ids>, tag: string): Row {
  const uniq = crypto.randomUUID().slice(0, 8);
  switch (table) {
    case "github_installations":
      return {
        user_id: userId,
        installation_id: Math.floor(Math.random() * 1e9) + 1,
        account_login: `acct-${tag}`,
      };
    case "projects":
      return {
        user_id: userId,
        installation_id: parents.github_installations,
        repo_full_name: `octo/${tag}-${uniq}`,
        default_branch: "main",
      };
    case "analyses":
      return { user_id: userId, project_id: parents.projects };
    case "jobs":
      return {
        user_id: userId,
        kind: "analyze",
        ref_id: parents.analyses,
        step: "validate",
        state: { selected_paths: ["src/index.ts"] },
      };
    case "security_findings":
      return {
        user_id: userId,
        analysis_id: parents.analyses,
        category: "hardcoded_secret",
        severity: "high",
        file_path: "src/a.ts",
        line: 1,
        masked_evidence: "sk…12",
        remediation: "Rotate the key.",
      };
    case "recommendations":
      return {
        user_id: userId,
        analysis_id: parents.analyses,
        title: "Notify on signup",
        description: "Send a Slack message on signup.",
        trigger_kind: "webhook",
        confidence: 0.8,
        risk_level: "low",
      };
    case "flows":
      return { user_id: userId, recommendation_id: parents.recommendations, name: "Flow" };
    case "flow_test_runs":
      return {
        user_id: userId,
        flow_id: parents.flows,
        level: "valid",
        passed: false,
        simulator_version: "0",
      };
    case "usage_events":
      return { user_id: userId, kind: "analysis", ref_id: parents.analyses };
    case "audit_log":
      return { user_id: userId, action: "project.create", ref: parents.projects };
  }
}

interface Seeded {
  userId: string;
  client: SupabaseClient;
  ids: Ids;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!configured)("RLS (skipped: no local Supabase)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let a: Seeded;
  let b: Seeded;
  let c: Seeded;

  async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await p;
    if (error !== null) throw new Error(error.message);
    return data;
  }

  async function countRows(table: string, column: string, value: string): Promise<number> {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    if (error !== null) throw new Error(error.message);
    return count ?? 0;
  }

  async function seedUser(tag: string): Promise<Seeded> {
    const email = `rls-${tag}-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error !== null || created.data.user === null) throw new Error("createUser failed");
    const userId = created.data.user.id;

    const client = createClient(url ?? "", anonKey ?? "", noSession);
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error !== null) throw new Error("signIn failed");

    const ids: Partial<Ids> = {};
    // Insert in FK order so every parent exists.
    for (const table of OWNED_TABLES) {
      const row = (await must(
        admin.from(table).insert(validRow(table, userId, ids, tag)).select("id").single(),
      )) as { id: string };
      ids[table] = row.id;
    }
    return { userId, client, ids: ids as Ids };
  }

  beforeAll(async () => {
    admin = createClient(url ?? "", serviceKey ?? "", noSession);
    anon = createClient(url ?? "", anonKey ?? "", noSession);
    a = await seedUser("a");
    b = await seedUser("b");
    c = await seedUser("c");
  }, 90_000);

  afterAll(async () => {
    if (admin === undefined) return;
    for (const user of [a, b, c]) {
      if (user !== undefined) await admin.auth.admin.deleteUser(user.userId);
    }
  });

  for (const table of OWNED_TABLES) {
    describe(table, () => {
      const cols = table === "jobs" ? "id, user_id" : "id";
      const probe = UPDATE_PROBE[table];

      it("owner can read own row", async () => {
        const { data, error } = await a.client.from(table).select(cols).eq("id", a.ids[table]);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("user A cannot read user B's row", async () => {
        const { data } = await a.client.from(table).select(cols).eq("id", b.ids[table]);
        expect(data ?? []).toHaveLength(0);
        const all = await a.client.from(table).select("user_id");
        for (const row of (all.data ?? []) as unknown as { user_id: string }[]) {
          expect(row.user_id).toBe(a.userId);
        }
      });

      it("user A cannot insert a complete valid row owned by B, nor one owned by A", async () => {
        const beforeB = await countRows(table, "user_id", b.userId);
        const asB = await a.client.from(table).insert(validRow(table, b.userId, b.ids, "x"));
        expect(asB.error?.code).toBe(PERMISSION_DENIED);
        expect(await countRows(table, "user_id", b.userId)).toBe(beforeB);

        const beforeA = await countRows(table, "user_id", a.userId);
        const asA = await a.client.from(table).insert(validRow(table, a.userId, a.ids, "x"));
        expect(asA.error?.code).toBe(PERMISSION_DENIED);
        expect(await countRows(table, "user_id", a.userId)).toBe(beforeA);
      });

      it(`user A cannot update ${probe.column} on own or B's row`, async () => {
        for (const id of [a.ids[table], b.ids[table]]) {
          const before = (await must(admin.from(table).select(probe.column).eq("id", id).single())) as Row;
          expect(before[probe.column]).not.toEqual(probe.value);
          const result = await a.client.from(table).update({ [probe.column]: probe.value }).eq("id", id);
          expect(result.error?.code).toBe(PERMISSION_DENIED);
          const after = (await must(admin.from(table).select(probe.column).eq("id", id).single())) as Row;
          expect(after[probe.column]).toEqual(before[probe.column]);
        }
      });

      it("user A cannot delete own or B's row", async () => {
        for (const id of [a.ids[table], b.ids[table]]) {
          const result = await a.client.from(table).delete().eq("id", id);
          expect(result.error?.code).toBe(PERMISSION_DENIED);
          expect(await countRows(table, "id", id)).toBe(1);
        }
      });

      it("anon sees nothing", async () => {
        const { data } = await anon.from(table).select("id");
        expect(data ?? []).toHaveLength(0);
      });
    });
  }

  it("jobs.state is not selectable by the owner", async () => {
    const { error } = await a.client.from("jobs").select("state").eq("id", a.ids.jobs);
    expect(error?.code).toBe(PERMISSION_DENIED);
    const star = await a.client.from("jobs").select("*").eq("id", a.ids.jobs);
    expect(star.error?.code).toBe(PERMISSION_DENIED);
  });

  it("rate_limits is unreachable for clients and rate_limit_hit is service-role only", async () => {
    const read = await a.client.from("rate_limits").select("key");
    expect(read.error?.code).toBe(PERMISSION_DENIED);
    const rpcA = await a.client.rpc("rate_limit_hit", { p_key: "rl:test", p_limit: 1 });
    expect(rpcA.error).not.toBeNull();

    const key = `rl:rls-test:${crypto.randomUUID()}:0`;
    expect(await must(admin.rpc("rate_limit_hit", { p_key: key, p_limit: 2 }))).toBe(true);
    expect(await must(admin.rpc("rate_limit_hit", { p_key: key, p_limit: 2 }))).toBe(true);
    expect(await must(admin.rpc("rate_limit_hit", { p_key: key, p_limit: 2 }))).toBe(false);
    await admin.from("rate_limits").delete().eq("key", key);
  });

  it("delete_project is service-role only", async () => {
    const result = await a.client.rpc("delete_project", { p_user_id: a.userId, p_project_id: a.ids.projects });
    expect(result.error).not.toBeNull();
    expect(await countRows("projects", "id", a.ids.projects)).toBe(1);
  });

  it("profiles: A cannot read or update B's profile", async () => {
    const read = await a.client.from("profiles").select("id").eq("id", b.userId);
    expect(read.data ?? []).toHaveLength(0);
    await a.client.from("profiles").update({ display_name: "hijack" }).eq("id", b.userId);
    const after = (await must(admin.from("profiles").select("display_name").eq("id", b.userId).single())) as {
      display_name: string | null;
    };
    expect(after.display_name).not.toBe("hijack");
  });

  it("projects cannot reference another user's installation (composite FK, R1-7)", async () => {
    const result = await admin.from("projects").insert({
      user_id: a.userId,
      installation_id: b.ids.github_installations,
      repo_full_name: `octo/fk-${crypto.randomUUID().slice(0, 8)}`,
      default_branch: "main",
    });
    expect(result.error?.code).toBe("23503"); // foreign_key_violation
  });

  it("delete_project removes the project, its cascade, and its jobs in one call (R1-1)", async () => {
    // Add a generate job pointing at the flow too.
    const flowJob = (await must(
      admin
        .from("jobs")
        .insert({ user_id: c.userId, kind: "generate", ref_id: c.ids.flows, step: "ai", status: "done" })
        .select("id")
        .single(),
    )) as { id: string };

    // Wrong owner: no-op, returns false.
    expect(await must(admin.rpc("delete_project", { p_user_id: a.userId, p_project_id: c.ids.projects }))).toBe(false);
    expect(await countRows("projects", "id", c.ids.projects)).toBe(1);

    expect(await must(admin.rpc("delete_project", { p_user_id: c.userId, p_project_id: c.ids.projects }))).toBe(true);
    expect(await countRows("projects", "id", c.ids.projects)).toBe(0);
    expect(await countRows("analyses", "id", c.ids.analyses)).toBe(0);
    expect(await countRows("security_findings", "id", c.ids.security_findings)).toBe(0);
    expect(await countRows("recommendations", "id", c.ids.recommendations)).toBe(0);
    expect(await countRows("flows", "id", c.ids.flows)).toBe(0);
    expect(await countRows("flow_test_runs", "id", c.ids.flow_test_runs)).toBe(0);
    expect(await countRows("jobs", "id", c.ids.jobs)).toBe(0);
    expect(await countRows("jobs", "id", flowJob.id)).toBe(0);
    // Unrelated users untouched.
    expect(await countRows("jobs", "id", a.ids.jobs)).toBe(1);
  });

  it("deleting an installation nulls projects.installation_id and keeps user_id", async () => {
    await must(admin.from("github_installations").delete().eq("id", a.ids.github_installations).select("id"));
    const project = (await must(
      admin.from("projects").select("installation_id, user_id").eq("id", a.ids.projects).single(),
    )) as { installation_id: string | null; user_id: string };
    expect(project.installation_id).toBeNull();
    expect(project.user_id).toBe(a.userId);
  });
});
