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
        // Required since 20261113000000_phase1_1_project_branch.sql (S11-2).
        branch: "main",
      };
    case "analyses":
      return { user_id: userId, project_id: parents.projects, branch: "main" };
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
  /** github_installation_repos row (composite PK, no id column). */
  repoId: number;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** A GitHub user id no other test (or earlier run) holds (D-44). */
function randomGithubId(): number {
  return Math.floor(Math.random() * 1e12) + 1_000_000;
}

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
    const repoId = Math.floor(Math.random() * 1e9) + 1;
    await must(
      admin
        .from("github_installation_repos")
        .insert({
          user_id: userId,
          installation_id: ids.github_installations,
          repo_id: repoId,
          repo_full_name: `octo/${tag}-access`,
          private: true,
          default_branch: "main",
        })
        .select("repo_id"),
    );
    return { userId, client, ids: ids as Ids, repoId };
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

  it("Phase 2 functions claim_job, kick_worker, purge_rate_limits are service-role only", async () => {
    const claim = await a.client.rpc("claim_job", { p_worker_id: "client" });
    expect(claim.error).not.toBeNull();
    const kick = await a.client.rpc("kick_worker");
    expect(kick.error).not.toBeNull();
    const purge = await a.client.rpc("purge_rate_limits");
    expect(purge.error).not.toBeNull();
    // Service role: purge runs; kick_worker is a no-op (false) without pg_net / Vault secrets.
    expect(typeof (await must(admin.rpc("purge_rate_limits")))).toBe("number");
    expect(typeof (await must(admin.rpc("kick_worker")))).toBe("boolean");
  });

  it("A cannot read B's analyses.signals / validation or recommendations.node_types (Phase 2 columns)", async () => {
    const analyses = await a.client.from("analyses").select("id, signals, validation").eq("id", b.ids.analyses);
    expect(analyses.data ?? []).toEqual([]);
    const recs = await a.client.from("recommendations").select("id, node_types, rationale").eq("id", b.ids.recommendations);
    expect(recs.data ?? []).toEqual([]);
  });

  it("one active analysis per project (partial unique index)", async () => {
    const second = await admin.from("analyses").insert({
      project_id: a.ids.projects,
      user_id: a.userId,
      status: "queued",
      branch: "main",
    });
    expect(second.error?.code).toBe("23505");
  });

  describe("Phase 3b flows (D-41, 20261126000000_phase3_flows.sql)", () => {
    it("user B cannot read user A's flow, including its spec and export columns", async () => {
      const { data } = await b.client
        .from("flows")
        .select("id, flow_spec, n8n_json, setup_checklist")
        .eq("id", a.ids.flows);
      expect(data ?? []).toEqual([]);
    });

    it("the partial unique index rejects a second generating or ready flow; failed attempts are allowed", async () => {
      const row = (status: string) => ({
        user_id: a.userId,
        recommendation_id: a.ids.recommendations,
        name: `rls-${status}`,
        status,
      });
      // The seeded flow is generating.
      const generating = await admin.from("flows").insert(row("generating"));
      expect(generating.error?.code).toBe("23505");
      const ready = await admin.from("flows").insert(row("ready"));
      expect(ready.error?.code).toBe("23505");
      const failed = await admin.from("flows").insert(row("failed")).select("id").single();
      expect(failed.error).toBeNull();
      if (failed.data !== null) await admin.from("flows").delete().eq("id", (failed.data as { id: string }).id);
    });
  });

  it("concurrent link_github_installations calls of a user with no rows are serialised (S11-7 advisory lock)", async () => {
    const e = await seedUser("e");
    try {
      await admin.from("github_installations").delete().eq("user_id", e.userId);
      const gid = randomGithubId();
      const link = (installationId: number) =>
        admin.rpc("link_github_installations", {
          p_user_id: e.userId,
          p_github_user_id: gid,
          p_github_user_login: "octocat",
          p_installations: [
            { installationId, accountLogin: "org", accountType: "Organization", accountId: 515000, repos: [{ id: installationId, fullName: "org/r", private: false, defaultBranch: "main" }] },
          ],
        });
      const results = await Promise.all([link(515151), link(515151)]);
      for (const result of results) expect(result.error).toBeNull();
      expect(await countRows("github_installations", "user_id", e.userId)).toBe(1);
    } finally {
      await admin.auth.admin.deleteUser(e.userId);
    }
  });

  describe("claim_job / expire_stale_jobs (R2-3, D-27, D-29)", () => {
    type ClaimRow = { id: string; attempts: number; status: string; locked_by: string };
    const claim = async (worker: string, userId: string | null) =>
      (await must(admin.rpc("claim_job", { p_worker_id: worker, p_user_id: userId }))) as ClaimRow[];

    it("claims a due job once; a concurrent claim gets 0 rows; p_user_id filters; future run_after is skipped; stale lock re-claimed", async () => {
      const f = await seedUser("f");
      try {
        // p_user_id filters to that user only.
        expect(await claim("w-other", crypto.randomUUID())).toEqual([]);
        // Two concurrent claims of f's single due job: exactly one row in total.
        const [x, y] = await Promise.all([claim("w-1", f.userId), claim("w-2", f.userId)]);
        const claimed = [...x, ...y];
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({ id: f.ids.jobs, status: "running", attempts: 1 });
        // Running with a fresh lock: not claimable.
        expect(await claim("w-3", f.userId)).toEqual([]);
        // Lock older than 2 minutes: re-claimed with attempts + 1.
        await must(
          admin
            .from("jobs")
            .update({ locked_at: new Date(Date.now() - 3 * 60_000).toISOString() })
            .eq("id", f.ids.jobs)
            .select("id"),
        );
        const again = await claim("w-4", f.userId);
        expect(again).toHaveLength(1);
        expect(again[0]).toMatchObject({ attempts: 2, locked_by: "w-4" });
        // Future run_after: not claimed.
        await must(
          admin
            .from("jobs")
            .update({ status: "queued", locked_at: null, locked_by: null, run_after: new Date(Date.now() + 3_600_000).toISOString() })
            .eq("id", f.ids.jobs)
            .select("id"),
        );
        expect(await claim("w-5", f.userId)).toEqual([]);
      } finally {
        await admin.auth.admin.deleteUser(f.userId);
      }
    });

    it("a job idle for 61 minutes is expired: JOB_EXPIRED, empty state, analysis failed", async () => {
      const g = await seedUser("g");
      try {
        await must(admin.from("jobs").delete().eq("id", g.ids.jobs).select("id"));
        const old = new Date(Date.now() - 61 * 60_000).toISOString();
        const inserted = (await must(
          admin
            .from("jobs")
            .insert({
              user_id: g.userId,
              kind: "analyze",
              ref_id: g.ids.analyses,
              step: "fetch:0",
              state: { snippets: [{ path: "a.ts", text: "redacted" }] },
              updated_at: old,
            })
            .select("id")
            .single(),
        )) as { id: string };
        expect(await must(admin.rpc("expire_stale_jobs"))).toBeGreaterThanOrEqual(1);
        const job = (await must(
          admin.from("jobs").select("status, state, last_error_code").eq("id", inserted.id).single(),
        )) as { status: string; state: unknown; last_error_code: string };
        expect(job).toEqual({ status: "failed", state: {}, last_error_code: "JOB_EXPIRED" });
        const analysis = (await must(
          admin.from("analyses").select("status, error_code").eq("id", g.ids.analyses).single(),
        )) as { status: string; error_code: string };
        expect(analysis).toEqual({ status: "failed", error_code: "JOB_EXPIRED" });
      } finally {
        await admin.auth.admin.deleteUser(g.userId);
      }
    });

    it("expire_stale_jobs is service-role only", async () => {
      expect((await a.client.rpc("expire_stale_jobs")).error).not.toBeNull();
    });
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

  it("A cannot read B's projects.branch or analyses.branch (S11-2)", async () => {
    const projects = await a.client.from("projects").select("branch").eq("id", b.ids.projects);
    expect(projects.data ?? []).toHaveLength(0);
    const analyses = await a.client.from("analyses").select("branch").eq("id", b.ids.analyses);
    expect(analyses.data ?? []).toHaveLength(0);
  });

  describe("github_installation_repos (D-22)", () => {
    const repoRow = (owner: Seeded, installationId: string) => ({
      user_id: owner.userId,
      installation_id: installationId,
      repo_id: Math.floor(Math.random() * 1e9) + 1,
      repo_full_name: "octo/injected",
      private: false,
      default_branch: "main",
    });

    it("owner can read own access rows", async () => {
      const { data, error } = await a.client
        .from("github_installation_repos")
        .select("repo_id")
        .eq("installation_id", a.ids.github_installations);
      expect(error).toBeNull();
      expect(data).toEqual([{ repo_id: a.repoId }]);
    });

    it("user A cannot read user B's access rows", async () => {
      const { data } = await a.client
        .from("github_installation_repos")
        .select("repo_id")
        .eq("installation_id", b.ids.github_installations);
      expect(data ?? []).toHaveLength(0);
    });

    it("anon sees nothing", async () => {
      const { data } = await anon.from("github_installation_repos").select("repo_id");
      expect(data ?? []).toHaveLength(0);
    });

    it("clients cannot insert, update, or delete access rows (own or B's)", async () => {
      for (const row of [repoRow(a, a.ids.github_installations), repoRow(b, b.ids.github_installations)]) {
        const inserted = await a.client.from("github_installation_repos").insert(row);
        expect(inserted.error?.code).toBe(PERMISSION_DENIED);
      }
      for (const owner of [a, b]) {
        const updated = await a.client
          .from("github_installation_repos")
          .update({ repo_full_name: "octo/hijacked" })
          .eq("repo_id", owner.repoId);
        expect(updated.error?.code).toBe(PERMISSION_DENIED);
        const deleted = await a.client.from("github_installation_repos").delete().eq("repo_id", owner.repoId);
        expect(deleted.error?.code).toBe(PERMISSION_DENIED);
      }
      expect(
        await must(admin.from("github_installation_repos").select("repo_id").eq("repo_id", b.repoId)),
      ).toHaveLength(1);
    });

    it("access rows cannot point at another user's installation (composite FK)", async () => {
      const result = await admin.from("github_installation_repos").insert(repoRow(a, b.ids.github_installations));
      expect(result.error?.code).toBe("23503");
    });

    it("repo full names with . or .. segments are rejected by the check constraint (S11-4)", async () => {
      for (const name of ["octo/..", "octo/.", "a_b/c"]) {
        const result = await admin
          .from("github_installation_repos")
          .insert({ ...repoRow(a, a.ids.github_installations), repo_full_name: name });
        expect(result.error?.code).toBe("23514");
      }
    });

    it("link_github_installations is service-role only", async () => {
      const result = await a.client.rpc("link_github_installations", {
        p_user_id: a.userId,
        p_github_user_id: 1,
        p_github_user_login: "x",
        p_installations: [],
      });
      expect(result.error).not.toBeNull();
    });

    it("link_github_installations replaces the set, deletes the unlisted pre-Phase-1.2 row, and refuses another GitHub account", async () => {
      const d = await seedUser("d");
      const gid = randomGithubId();
      try {
        const link = (githubUserId: number, repos: { id: number; fullName: string }[]) =>
          admin.rpc("link_github_installations", {
            p_user_id: d.userId,
            p_github_user_id: githubUserId,
            p_github_user_login: "octocat",
            p_installations: [
              {
                installationId: 424242,
                accountLogin: "octo-org",
                accountType: "Organization",
                accountId: 424200,
                repos: repos.map((repo) => ({ ...repo, private: true, defaultBranch: "main" })),
              },
            ],
          });
        const first = await must(link(gid, [{ id: 1, fullName: "octo-org/a" }, { id: 2, fullName: "octo-org/b" }]));
        expect(first).toEqual([{ installation_id: 424242, inserted: true }]);
        await must(link(gid, [{ id: 3, fullName: "octo-org/c" }]));
        const rows = (await must(
          admin.from("github_installation_repos").select("repo_full_name").eq("user_id", d.userId),
        )) as { repo_full_name: string }[];
        expect(rows.map((row) => row.repo_full_name).sort()).toEqual(["octo-org/c"]);
        // The seeded row (unclassified, not listed) was deleted (D-45); its project is detached.
        expect(await countRows("github_installations", "id", d.ids.github_installations)).toBe(0);
        const project = (await must(
          admin.from("projects").select("installation_id").eq("id", d.ids.projects).single(),
        )) as { installation_id: string | null };
        expect(project.installation_id).toBeNull();
        const mismatch = await link(gid + 1, [{ id: 9, fullName: "octo-org/z" }]);
        expect(mismatch.error?.message ?? "").toContain("github_account_mismatch");
        const after = (await must(
          admin.from("github_installation_repos").select("repo_full_name").eq("user_id", d.userId),
        )) as { repo_full_name: string }[];
        expect(after.map((row) => row.repo_full_name)).toEqual(["octo-org/c"]);
      } finally {
        await admin.auth.admin.deleteUser(d.userId);
      }
    });
  });

  describe("Phase 1.2 GitHub account isolation (D-43, D-44, D-45)", () => {
    type Item = { installationId: number; accountType: string; accountId: number; repoIds?: number[] };
    const link = (userId: string, githubUserId: number, items: Item[]) =>
      admin.rpc("link_github_installations", {
        p_user_id: userId,
        p_github_user_id: githubUserId,
        p_github_user_login: "octocat",
        p_installations: items.map((item) => ({
          installationId: item.installationId,
          accountLogin: `acct-${item.installationId}`,
          accountType: item.accountType,
          accountId: item.accountId,
          repos: (item.repoIds ?? []).map((id) => ({ id, fullName: `acct/r${id}`, private: true, defaultBranch: "main" })),
        })),
      });
    const instId = () => Math.floor(Math.random() * 1e9) + 1;
    const rowsOf = async (userId: string) =>
      (await must(
        admin
          .from("github_installations")
          .select("id, installation_id, account_type, account_id, github_user_id, repos_synced_at")
          .eq("user_id", userId)
          .order("installation_id"),
      )) as { id: string; installation_id: number; account_type: string | null; account_id: number | null; github_user_id: number | null; repos_synced_at: string | null }[];
    const repoCount = (installationRowId: string) => countRows("github_installation_repos", "installation_id", installationRowId);

    async function withUsers(tags: string[], run: (users: Seeded[]) => Promise<void>) {
      const users: Seeded[] = [];
      try {
        for (const tag of tags) {
          const user = await seedUser(tag);
          // Start without the seeded (unclassified) installation row.
          await must(admin.from("github_installations").delete().eq("user_id", user.userId).select("id"));
          users.push(user);
        }
        await run(users);
      } finally {
        for (const user of users) await admin.auth.admin.deleteUser(user.userId);
      }
    }

    it("(i) a second user linking a held GitHub account → github_in_use, nothing written, holder unchanged", async () => {
      await withUsers(["p12a", "p12b"], async ([ua, ub]) => {
        const g = randomGithubId();
        const org = instId();
        await must(link(ua!.userId, g, [{ installationId: org, accountType: "Organization", accountId: 5, repoIds: [1] }]));
        const before = await rowsOf(ua!.userId);
        const result = await link(ub!.userId, g, [{ installationId: org, accountType: "Organization", accountId: 5, repoIds: [1] }]);
        expect(result.error?.message ?? "").toContain("github_in_use");
        expect(await rowsOf(ub!.userId)).toEqual([]);
        expect(await rowsOf(ua!.userId)).toEqual(before);
        // Checked even with no installations listed.
        const empty = await link(ub!.userId, g, []);
        expect(empty.error?.message ?? "").toContain("github_in_use");
      });
    });

    it("(ii) after the holder deletes all its rows, another user links the GitHub account; the first then gets github_in_use", async () => {
      await withUsers(["p12c", "p12d"], async ([ua, ub]) => {
        const g = randomGithubId();
        const own = instId();
        await must(link(ua!.userId, g, [{ installationId: own, accountType: "User", accountId: g }]));
        await must(admin.from("github_installations").delete().eq("user_id", ua!.userId).select("id"));
        await must(link(ub!.userId, g, [{ installationId: own, accountType: "User", accountId: g }]));
        expect((await rowsOf(ub!.userId)).map((row) => row.github_user_id)).toEqual([g]);
        const back = await link(ua!.userId, g, [{ installationId: own, accountType: "User", accountId: g }]);
        expect(back.error?.message ?? "").toContain("github_in_use");
        expect(await rowsOf(ua!.userId)).toEqual([]);
      });
    });

    it("(iii) another person's personal installation → installation_not_allowed, nothing written", async () => {
      await withUsers(["p12e"], async ([ua]) => {
        const g = randomGithubId();
        const ok = { installationId: instId(), accountType: "Organization", accountId: 5 };
        const result = await link(ua!.userId, g, [ok, { installationId: instId(), accountType: "User", accountId: g + 1 }]);
        expect(result.error?.message ?? "").toContain("installation_not_allowed");
        for (const accountType of ["Enterprise", "Bot"]) {
          const other = await link(ua!.userId, g, [{ installationId: instId(), accountType, accountId: 5 }]);
          expect(other.error?.message ?? "").toContain("installation_not_allowed");
        }
        const missing = await admin.rpc("link_github_installations", {
          p_user_id: ua!.userId,
          p_github_user_id: g,
          p_github_user_login: "octocat",
          p_installations: [{ installationId: instId(), accountLogin: "x", repos: [] }],
        });
        expect(missing.error?.message ?? "").toContain("invalid_arguments");
        expect(await rowsOf(ua!.userId)).toEqual([]);
      });
    });

    it("(iv) a User row whose account_id differs from github_user_id violates github_installations_linkable_account", async () => {
      await withUsers(["p12f"], async ([ua]) => {
        const g = randomGithubId();
        const base = { user_id: ua!.userId, installation_id: instId(), account_login: "x", github_user_id: g, github_user_login: "octocat" };
        const bad = await admin.from("github_installations").insert({ ...base, account_type: "User", account_id: g + 1 });
        expect(bad.error?.code).toBe("23514");
        const enterprise = await admin.from("github_installations").insert({ ...base, account_type: "Enterprise", account_id: 5 });
        expect(enterprise.error?.code).toBe("23514");
        const syncedUnclassified = await admin
          .from("github_installations")
          .insert({ ...base, repos_synced_at: new Date().toISOString() });
        expect(syncedUnclassified.error?.code).toBe("23514");
        expect(await rowsOf(ua!.userId)).toEqual([]);
      });
    });

    it("(v) cleanup: an unlisted pre-Phase-1.2 row is deleted with its project detached; a classified org row is kept, then only cleared", async () => {
      await withUsers(["p12g"], async ([ua]) => {
        const g = randomGithubId();
        const x = instId();
        const y = instId();
        const legacy = (await must(
          admin
            .from("github_installations")
            .insert({ user_id: ua!.userId, installation_id: x, account_login: "owner-person", github_user_id: g, github_user_login: "octocat" })
            .select("id")
            .single(),
        )) as { id: string };
        await must(
          admin.from("github_installation_repos").insert({
            user_id: ua!.userId, installation_id: legacy.id, repo_id: 77, repo_full_name: "owner-person/p", private: true, default_branch: "main",
          }).select("repo_id"),
        );
        const project = (await must(
          admin
            .from("projects")
            .insert({ user_id: ua!.userId, installation_id: legacy.id, repo_full_name: `owner-person/p-${crypto.randomUUID().slice(0, 8)}`, default_branch: "main", branch: "main" })
            .select("id")
            .single(),
        )) as { id: string };
        await must(link(ua!.userId, g, [{ installationId: y, accountType: "Organization", accountId: 5, repoIds: [1, 2] }]));
        expect(await countRows("github_installations", "id", legacy.id)).toBe(0);
        expect(await repoCount(legacy.id)).toBe(0);
        const detached = (await must(admin.from("projects").select("installation_id").eq("id", project.id).single())) as { installation_id: string | null };
        expect(detached.installation_id).toBeNull();
        const kept = await rowsOf(ua!.userId);
        expect(kept.map((row) => [row.installation_id, row.account_type, row.account_id])).toEqual([[y, "Organization", 5]]);
        expect(await repoCount(kept[0]!.id)).toBe(2);

        await must(link(ua!.userId, g, []));
        const cleared = await rowsOf(ua!.userId);
        expect(cleared.map((row) => [row.installation_id, row.repos_synced_at])).toEqual([[y, null]]);
        expect(await repoCount(cleared[0]!.id)).toBe(0);
      });
    });

    it("(vi) one org installation listed for two users with different GitHub ids is linked for both", async () => {
      await withUsers(["p12h", "p12i"], async ([ua, ub]) => {
        const org = instId();
        await must(link(ua!.userId, randomGithubId(), [{ installationId: org, accountType: "Organization", accountId: 5, repoIds: [1] }]));
        await must(link(ub!.userId, randomGithubId(), [{ installationId: org, accountType: "Organization", accountId: 5, repoIds: [2] }]));
        expect((await rowsOf(ua!.userId)).map((row) => row.installation_id)).toEqual([org]);
        expect((await rowsOf(ub!.userId)).map((row) => row.installation_id)).toEqual([org]);
      });
    });

    it("(vii) A cannot read B's account_type / account_id", async () => {
      const { data } = await a.client
        .from("github_installations")
        .select("id, account_type, account_id")
        .eq("id", b.ids.github_installations);
      expect(data ?? []).toEqual([]);
      const own = await a.client.from("github_installations").select("account_type, account_id").eq("id", a.ids.github_installations);
      expect(own.error).toBeNull();
    });
  });

  it("projects cannot reference another user's installation (composite FK, R1-7)", async () => {
    const result = await admin.from("projects").insert({
      user_id: a.userId,
      installation_id: b.ids.github_installations,
      repo_full_name: `octo/fk-${crypto.randomUUID().slice(0, 8)}`,
      default_branch: "main",
      branch: "main",
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
