// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createFakeModel, type FakeModel } from "@/lib/analysis/model/fake";
import { ModelProviderError } from "@/lib/analysis/model/types";
import { FETCH_BATCH_SIZE, decodeText, fetchProgress } from "@/lib/jobs/analyze";
import type { WorkerDeps } from "@/lib/jobs/types";
import { backoffMs, runOnce, type RunResult } from "@/lib/jobs/worker";

import { ANALYSIS, FakeClock, FakeGitHub, FakeWorkerDb, HEAD, PROJECT, USER } from "./fakes";

const SECRET = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

const WEB_REPO: Record<string, string | Uint8Array> = {
  "package.json": JSON.stringify({ dependencies: { next: "16", stripe: "1" } }),
  ".env": "STRIPE_SECRET=should-never-be-read",
  ".env.example": "STRIPE_KEY=\nAPP_URL=\n",
  "src/app/api/webhooks/stripe/route.ts":
    `const token = "${SECRET}";\nexport async function POST(req) { stripe.webhooks.constructEvent(b, s, k); await supabase.from('orders').insert(x); return process.env.STRIPE_KEY; }\n`,
  "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron", schedule: "0 3 * * *" }] }),
  "README.md": "# Shop\n",
  "logo.png": new Uint8Array([137, 80, 78, 71]),
  "src/binary.ts": new Uint8Array([104, 0, 105]),
};

function setup(
  files: Record<string, string | Uint8Array> = WEB_REPO,
  options: { model?: FakeModel | null; branch?: string; installationRowId?: string | null } = {},
) {
  const clock = new FakeClock();
  const db = new FakeWorkerDb(clock);
  db.seed({
    ...(options.branch !== undefined ? { branch: options.branch } : {}),
    ...(options.installationRowId !== undefined ? { installationRowId: options.installationRowId } : {}),
  });
  const github = new FakeGitHub(files);
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const deps: WorkerDeps = {
    db,
    github,
    model: options.model === undefined ? null : options.model,
    now: clock.now,
    workerId: "test-worker",
    log: (event, fields) => logs.push({ event, fields }),
  };
  return { clock, db, github, deps, logs };
}

/** Runs the worker until idle (advancing past backoff when `skipBackoff`). */
async function drain(deps: WorkerDeps, clock: FakeClock, skipBackoff = false): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (let i = 0; i < 200; i += 1) {
    const result = await runOnce(deps);
    results.push(result);
    if (result.outcome === "idle") {
      if (!skipBackoff) break;
      const db = deps.db as FakeWorkerDb;
      if (db.job.status !== "queued") break;
      clock.ms = Date.parse(db.job.run_after);
    }
  }
  return results;
}

describe("worker: happy path with AI disabled", () => {
  it("ends done with AI_DISABLED, findings and signals saved, state cleared", async () => {
    const { db, deps, clock, github } = setup();
    await drain(deps, clock);
    const analysis = db.analysis;
    expect(analysis.status).toBe("done");
    expect(analysis.error_code).toBe("AI_DISABLED");
    expect(analysis.progress).toBe(100);
    expect(analysis.commit_sha).toBe(HEAD);
    expect(analysis.validation).toEqual({ kind: "website", reason: null });
    expect(analysis.finished_at).toBe(clock.now().toISOString());
    expect(analysis.files_considered).toBe(8);
    expect(analysis.files_blocked_by_reason).toEqual({ denied: 1, extension: 2, size: 0, cap: 0 });
    expect(analysis.files_blocked).toBe(3);
    expect(analysis.files_read).toBe(5);
    expect(analysis.files_skipped_budget).toBe(0);
    const signals = analysis.signals as { kind: string; label: string }[];
    expect(signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["route", "webhook", "schedule", "db_write", "env_var"]),
    );
    expect(db.findings.map((f) => [f.category, f.filePath])).toEqual(
      expect.arrayContaining([
        ["committed_env_file", ".env"],
        ["hardcoded_secret", "src/app/api/webhooks/stripe/route.ts"],
      ]),
    );
    expect(db.recommendations).toEqual([]);
    expect(db.usage).toEqual([]);
    expect(db.job.status).toBe("done");
    expect(db.job.state).toEqual({});
    expect(db.projects.get(PROJECT)).toMatchObject({ status: "valid", detected_kind: "website", last_commit_sha: HEAD, stale: false });
    // The denied .env was never fetched.
    expect(github.blobPathsFetched()).not.toContain(".env");
  });

  it("never writes raw secrets or file text into job state, and never logs them", async () => {
    const { db, deps, clock, logs } = setup(WEB_REPO, { model: createFakeModel() });
    await drain(deps, clock);
    expect(db.stateWrites.length).toBeGreaterThan(3);
    for (const written of db.stateWrites) {
      expect(written).not.toContain(SECRET);
      expect(written).not.toContain("should-never-be-read");
    }
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).not.toContain("constructEvent");
    expect(JSON.stringify(db.findings)).not.toContain(SECRET);
  });

  it("progress never decreases and follows the step mapping", async () => {
    const { db, deps, clock } = setup();
    await drain(deps, clock);
    const history = db.progressHistory;
    for (let i = 1; i < history.length; i += 1) expect(history[i]).toBeGreaterThanOrEqual(history[i - 1] ?? 0);
    expect(history).toEqual(expect.arrayContaining([5, 10, 60, 65, 70, 100]));
  });

  it("validate reads the analysis branch, never the default branch", async () => {
    const { deps, clock, github } = setup(WEB_REPO, { branch: "feature/x" });
    await drain(deps, clock);
    const branchCalls = github.calls.filter((call) => call.op === "branch");
    expect(branchCalls).toEqual([{ op: "branch", args: ["acme/shop", "feature/x"] }]);
    expect(github.calls.filter((call) => call.op === "tree").every((call) => call.args[1] === HEAD)).toBe(true);
  });
});

describe("worker: happy path with the fake model", () => {
  it("ends done with recommendations and one usage_events row", async () => {
    const model = createFakeModel();
    const { db, deps, clock } = setup(WEB_REPO, { model });
    await drain(deps, clock);
    expect(db.analysis.status).toBe("done");
    expect(db.analysis.error_code).toBeNull();
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.prompt).not.toContain(SECRET);
    expect(model.calls[0]?.prompt).toContain("[REDACTED]");
    expect(db.usage).toHaveLength(1);
    expect(db.usage[0]).toMatchObject({ userId: USER, kind: "analysis", refId: ANALYSIS });
    expect(db.recommendations.length).toBeGreaterThan(0);
    const webhook = db.recommendations.find((r) => r.trigger_kind === "webhook");
    expect(webhook?.source_files).toEqual(["src/app/api/webhooks/stripe/route.ts"]);
    expect(webhook?.estimated_tokens).toBeGreaterThan(4000);
    expect(webhook?.node_types).toContain("n8n-nodes-base.webhook");
    expect(db.job.state).toEqual({});
  });

  it("drops drafts with unknown node types without failing", async () => {
    const model = createFakeModel({
      extraDrafts: [
        {
          title: "Run a shell command",
          description: "Executes arbitrary shell commands on the n8n host.",
          trigger_kind: "manual",
          confidence: 0.9,
          source_files: [],
          required_credentials: [],
          risk_level: "high",
          node_types: ["n8n-nodes-base.executeCommand"],
          rationale: "This should be dropped by the allowlist.",
        },
      ],
    });
    const { db, deps, clock } = setup(WEB_REPO, { model });
    await drain(deps, clock);
    expect(db.analysis.status).toBe("done");
    expect(db.recommendations.some((r) => r.title === "Run a shell command")).toBe(false);
  });

  it("MODEL_OUTPUT_INVALID fails without retry; findings stay; usage logged", async () => {
    const model = createFakeModel({ script: ["this is not json"] });
    const { db, deps, clock } = setup(WEB_REPO, { model });
    await drain(deps, clock, true);
    expect(model.calls).toHaveLength(1);
    expect(db.analysis.status).toBe("failed");
    expect(db.analysis.error_code).toBe("MODEL_OUTPUT_INVALID");
    expect(db.findings.length).toBeGreaterThan(0);
    expect(db.usage).toHaveLength(1);
    expect(db.job).toMatchObject({ status: "failed", state: {}, last_error_code: "MODEL_OUTPUT_INVALID" });
  });

  it("the ai step is tried at most 2 times", async () => {
    const model = createFakeModel({
      script: [new ModelProviderError("x", 529, true), new ModelProviderError("x", 529, true), "[]"],
    });
    const { db, deps, clock } = setup(WEB_REPO, { model });
    await drain(deps, clock, true);
    expect(model.calls).toHaveLength(2);
    expect(db.analysis.status).toBe("failed");
    expect(db.analysis.error_code).toBe("INTERNAL");
    expect(db.usage).toHaveLength(0);
    expect(db.findings.length).toBeGreaterThan(0);
    expect(db.job.state).toEqual({});
  });

  it("a non-retryable provider error fails at once", async () => {
    const model = createFakeModel({ script: [new ModelProviderError("x", 401, false)] });
    const { db, deps, clock } = setup(WEB_REPO, { model });
    await drain(deps, clock, true);
    expect(model.calls).toHaveLength(1);
    expect(db.analysis.status).toBe("failed");
  });
});

describe("worker: terminal job codes", () => {
  it("PROJECT_INVALID → rejected, project invalid, no file fetched beyond manifests", async () => {
    const { db, deps, clock, github } = setup({ "README.md": "# docs", "docs/a.md": "x" });
    const results = await drain(deps, clock);
    expect(db.analysis).toMatchObject({
      status: "rejected",
      error_code: "PROJECT_INVALID",
      validation: { kind: "invalid", reason: "The repository only contains documentation." },
    });
    expect(db.projects.get(PROJECT)).toMatchObject({
      status: "invalid",
      invalid_reason: "The repository only contains documentation.",
      stale: false,
    });
    expect(db.job).toMatchObject({ status: "failed", state: {}, last_error_code: "PROJECT_INVALID" });
    expect(github.blobPathsFetched()).toEqual([]);
    expect(results.filter((r) => r.outcome === "failed")).toHaveLength(1);
  });

  it("BRANCH_NOT_FOUND when the branch 404s but the repo is readable (not retried)", async () => {
    const { db, deps, clock, github } = setup();
    github.branchStatus = 404;
    github.repoReadable = true;
    await drain(deps, clock, true);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "BRANCH_NOT_FOUND" });
    expect(db.job).toMatchObject({ status: "failed", attempts: 1, state: {} });
    expect(github.calls.filter((c) => c.op === "branch")).toHaveLength(1);
  });

  it("branch 404 and repo unreadable → GITHUB_ACCESS_LOST", async () => {
    const { db, deps, clock, github } = setup();
    github.branchStatus = 404;
    github.repoReadable = false;
    await drain(deps, clock, true);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "GITHUB_ACCESS_LOST" });
  });

  it.each([
    ["installation removed (installation_id null)", (g: FakeGitHub) => g, null],
    ["installation token 404", (g: FakeGitHub) => Object.assign(g, { mintStatus: 404 }), undefined],
    ["tree 403", (g: FakeGitHub) => Object.assign(g, { treeStatus: 403 }), undefined],
    ["blob 404", (g: FakeGitHub) => Object.assign(g, { blobStatus: 404 }), undefined],
  ])("GITHUB_ACCESS_LOST: %s (not retried)", async (_name, mutate, installationRowId) => {
    const { db, deps, clock, github } = setup(WEB_REPO, installationRowId === null ? { installationRowId: null } : {});
    mutate(github);
    await drain(deps, clock, true);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "GITHUB_ACCESS_LOST" });
    expect(db.job).toMatchObject({ status: "failed", attempts: 1, state: {}, last_error_code: "GITHUB_ACCESS_LOST" });
  });
});

describe("worker: retry and backoff", () => {
  it("backoff is 30s, 60s, 120s, 240s", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
  });

  it("retries a 5xx with backoff and fails INTERNAL after max_attempts", async () => {
    const { db, deps, clock, github } = setup();
    github.treeStatus = 502;
    const first = await runOnce(deps);
    expect(first.outcome).toBe("retry");
    expect(db.job).toMatchObject({ status: "queued", step: "validate", attempts: 1, last_error_code: "INTERNAL" });
    expect(Date.parse(db.job.run_after) - clock.ms).toBe(30_000);
    expect((await runOnce(deps)).outcome).toBe("idle");

    const delays: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      clock.ms = Date.parse(db.job.run_after);
      await runOnce(deps);
      delays.push(Date.parse(db.job.run_after) - clock.ms);
    }
    expect(delays).toEqual([60_000, 120_000, 240_000]);
    clock.ms = Date.parse(db.job.run_after);
    expect((await runOnce(deps)).outcome).toBe("failed");
    expect(db.job).toMatchObject({ status: "failed", attempts: 5, state: {}, last_error_code: "INTERNAL" });
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "INTERNAL" });
  });

  it("a recovered step resets attempts and the job finishes", async () => {
    const { db, deps, clock, github } = setup();
    github.treeStatus = 500;
    await runOnce(deps);
    github.treeStatus = 200;
    await drain(deps, clock, true);
    expect(db.analysis.status).toBe("done");
  });

  it("a step that exceeds its time budget is retried", async () => {
    const { db, deps, github } = setup();
    github.getTreeBlobs = () => new Promise(() => undefined);
    const result = await runOnce({ ...deps, stepTimeoutMs: 10 });
    expect(result.outcome).toBe("retry");
    expect(db.job).toMatchObject({ status: "queued", step: "validate" });
  });

  it("a lost lock stops the step from writing the job", async () => {
    const { db, deps } = setup();
    const original = db.updateJob.bind(db);
    db.updateJob = async (id, _worker, patch) => original(id, "someone-else", patch);
    const result = await runOnce(deps);
    expect(result.outcome).toBe("lock_lost");
  });
});

describe("worker: batches, budget, unreadable files", () => {
  it("fetches in batches of 25 and keeps going until all files are read", async () => {
    const files: Record<string, string> = { "package.json": JSON.stringify({ dependencies: { react: "18" } }) };
    for (let i = 0; i < 60; i += 1) files[`src/f${String(i).padStart(2, "0")}.ts`] = `export const a${i} = ${i};`;
    const { db, deps, clock } = setup(files);
    const results = await drain(deps, clock);
    const steps = results.map((r) => r.step).filter((s): s is string => s !== null);
    expect(steps.filter((s) => s.startsWith("fetch:"))).toEqual(["fetch:0", "fetch:1", "fetch:2"]);
    expect(db.analysis.files_read).toBe(61);
    expect(FETCH_BATCH_SIZE).toBe(25);
  });

  it("binary or invalid UTF-8 files are dropped and counted as extension", () => {
    expect(decodeText(new Uint8Array([104, 105]))).toBe("hi");
    expect(decodeText(new Uint8Array([104, 0]))).toBeNull();
    expect(decodeText(new Uint8Array([0xc3, 0x28]))).toBeNull();
  });

  it("fetch progress spreads from 10 to 60", () => {
    expect(fetchProgress(0, 4)).toBe(23);
    expect(fetchProgress(3, 4)).toBe(60);
  });

  it("files beyond the prompt budget are counted as skipped (AI on), 0 when AI is off", async () => {
    const files: Record<string, string> = { "package.json": JSON.stringify({ dependencies: { react: "18" } }) };
    for (let i = 0; i < 30; i += 1) files[`src/f${String(i).padStart(2, "0")}.ts`] = "x".repeat(19_000);
    const on = setup(files, { model: createFakeModel() });
    await drain(on.deps, on.clock);
    expect(on.db.analysis.status).toBe("done");
    expect(on.db.analysis.files_skipped_budget as number).toBeGreaterThan(0);
    expect(on.db.analysis.files_read).toBe(31);

    const off = setup(files);
    await drain(off.deps, off.clock);
    expect(off.db.analysis.files_skipped_budget).toBe(0);
  });

  it("idle when nothing is due", async () => {
    const { deps, db } = setup();
    db.job.status = "done";
    expect(await runOnce(deps)).toEqual({ outcome: "idle", jobId: null, step: null, more: false });
  });
});

// --- Phase 2 review fixes -------------------------------------------------------------

async function runUntilStep(deps: WorkerDeps, db: FakeWorkerDb, step: string): Promise<void> {
  for (let i = 0; i < 100 && db.job.step !== step; i += 1) {
    const result = await runOnce(deps);
    if (result.outcome === "idle") break;
  }
  expect(db.job.step).toBe(step);
}

describe("S2-1: repo identity at validate", () => {
  it("the name resolves to another repo id → GITHUB_ACCESS_LOST, no branch, tree or blob read", async () => {
    const { db, deps, clock, github } = setup();
    github.repoId = 999_999;
    await drain(deps, clock, true);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "GITHUB_ACCESS_LOST" });
    expect(db.job).toMatchObject({ status: "failed", attempts: 1, state: {} });
    expect(github.calls.filter((c) => ["branch", "tree", "blob"].includes(c.op))).toEqual([]);
  });

  it("a project without repo_id fails the same way", async () => {
    const clock = new FakeClock();
    const db = new FakeWorkerDb(clock);
    db.seed({ repoId: null });
    const github = new FakeGitHub(WEB_REPO);
    await drain({ db, github, model: null, now: clock.now, workerId: "w" }, clock, true);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "GITHUB_ACCESS_LOST" });
    expect(github.calls.filter((c) => c.op === "tree")).toEqual([]);
  });

  it("the repo no longer readable (404) → GITHUB_ACCESS_LOST", async () => {
    const { db, deps, clock, github } = setup();
    github.repoId = null;
    await drain(deps, clock, true);
    expect(db.analysis.error_code).toBe("GITHUB_ACCESS_LOST");
  });
});

describe("R2-1: hard ai limit across crashes", () => {
  it("a worker that crashes after each billed call never makes a third model call", async () => {
    const model = createFakeModel();
    const { db, deps, clock } = setup(WEB_REPO, { model });
    await runUntilStep(deps, db, "ai");
    const original = db.updateJob.bind(db);
    // Crash after the billed call: the advance to `persist` never lands.
    db.updateJob = async (id, worker, patch) => {
      if (patch.step === "persist") throw new Error("worker killed");
      return original(id, worker, patch);
    };
    for (let i = 0; i < 6; i += 1) {
      await runOnce(deps).catch(() => undefined);
      clock.advance(121_000);
    }
    expect(model.calls.length).toBeLessThanOrEqual(2);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "INTERNAL" });
    expect(db.job).toMatchObject({ status: "failed", state: {} });
  });
});

describe("R2-3: stale-lock resume and crash-loop end", () => {
  it("a crashed step is re-claimed after 2 minutes and the job finishes", async () => {
    const { db, deps, clock } = setup();
    await runUntilStep(deps, db, "fetch:0");
    // A worker claims the job and dies without writing.
    expect(await db.claimJob("dead-worker")).not.toBeNull();
    expect((await runOnce(deps)).outcome).toBe("idle");
    clock.advance(121_000);
    await drain(deps, clock);
    expect(db.analysis.status).toBe("done");
    expect(db.job.state).toEqual({});
  });

  it("a crash loop ends the job once attempts exceed max_attempts", async () => {
    const { db, deps, clock } = setup();
    for (let i = 0; i < 5; i += 1) {
      await db.claimJob("dead-worker");
      clock.advance(121_000);
    }
    const result = await runOnce(deps);
    expect(result.outcome).toBe("failed");
    expect(db.job).toMatchObject({ status: "failed", attempts: 6, last_error_code: "INTERNAL", state: {} });
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "INTERNAL" });
  });
});

describe("R2-5: an abandoned step makes no further writes", () => {
  it("writes stop once the step's time budget aborts it", async () => {
    const { db, deps, github } = setup();
    const originalTree = github.getTreeBlobs.bind(github);
    github.getTreeBlobs = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return originalTree(...args);
    };
    const result = await runOnce({ ...deps, stepTimeoutMs: 5 });
    expect(result.outcome).toBe("retry");
    const writesAtTimeout = db.progressHistory.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(db.progressHistory.length).toBe(writesAtTimeout);
    expect(db.projects.get(PROJECT)?.status).toBe("pending");
    expect(db.analysis.validation).toBeUndefined();
  });
});

describe("R2-6: files_skipped_budget is 0 when the ai step is skipped", () => {
  it("AI on at validate, model gone by detect → AI_DISABLED with 0 skipped", async () => {
    const files: Record<string, string> = { "package.json": JSON.stringify({ dependencies: { react: "18" } }) };
    for (let i = 0; i < 30; i += 1) files[`src/f${String(i).padStart(2, "0")}.ts`] = "x".repeat(19_000);
    const { db, deps, clock } = setup(files, { model: createFakeModel() });
    await runUntilStep(deps, db, "detect");
    expect((db.job.state as { skippedBudget: number }).skippedBudget).toBeGreaterThan(0);
    deps.model = null;
    await drain(deps, clock);
    expect(db.analysis).toMatchObject({ status: "done", error_code: "AI_DISABLED", files_skipped_budget: 0 });
  });
});
