// @vitest-environment node
/**
 * Phase 2c (D-35): the `ai` step budget, AI_UNAVAILABLE retry rules, empty
 * output → MODEL_OUTPUT_INVALID, and the `ai.failed` log line. Fake models
 * and stubbed fetch only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnthropicModel } from "@/lib/analysis/model/anthropic";
import { createFakeModel } from "@/lib/analysis/model/fake";
import type { FetchLike } from "@/lib/analysis/model/http";
import { createOpenRouterModel } from "@/lib/analysis/model/openrouter";
import { ModelProviderError, type AnalysisModel } from "@/lib/analysis/model/types";
import type { WorkerDeps } from "@/lib/jobs/types";
import { aiStepBudgetMs, backoffMs, runOnce } from "@/lib/jobs/worker";

import { FakeClock, FakeWorkerDb, FakeGitHub } from "./fakes";

const KEY = "sk-test-key-not-real-PHASE2C-0002";
const MODEL_ID = "vendor/marker-model-id:free";
const BODY_MARKER = "BODY_MARKER_c41d";

const REPO: Record<string, string> = {
  "package.json": JSON.stringify({ dependencies: { next: "16", stripe: "1" } }),
  "src/app/api/webhooks/stripe/route.ts":
    `const token = "ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}";\nexport async function POST(req) { stripe.webhooks.constructEvent(b, s, k); return 1; }\n`,
  "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron", schedule: "0 3 * * *" }] }),
};

interface Spy {
  calls: number;
}

function counted(model: AnalysisModel, spy: Spy): AnalysisModel {
  return {
    timeoutMs: model.timeoutMs,
    analyze: (input) => {
      spy.calls += 1;
      return model.analyze(input);
    },
  };
}

function setup(model: AnalysisModel) {
  const clock = new FakeClock();
  const db = new FakeWorkerDb(clock);
  db.seed();
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const deps: WorkerDeps = {
    db,
    github: new FakeGitHub(REPO),
    model,
    now: clock.now,
    workerId: "test-worker",
    log: (event, fields) => logs.push({ event, fields }),
  };
  return { clock, db, deps, logs };
}

/** Runs until the job sits at the `ai` step, due now. */
async function runToAi(deps: WorkerDeps, db: FakeWorkerDb) {
  for (let i = 0; i < 50 && db.job.step !== "ai"; i += 1) await runOnce(deps);
  expect(db.job.step).toBe("ai");
}

function snapshot(db: FakeWorkerDb) {
  return { signals: JSON.stringify(db.analysis.signals), findings: JSON.stringify(db.findings) };
}

const aiFailed = (logs: { event: string; fields: Record<string, unknown> }[]) =>
  logs.filter((line) => line.event === "ai.failed").map((line) => line.fields);

function expectSafeLog(fields: Record<string, unknown>) {
  expect(Object.keys(fields).sort()).toEqual(["attempt", "elapsedMs", "jobId", "reason", "status"]);
  expect(typeof fields.elapsedMs).toBe("number");
  const text = JSON.stringify(fields).toLowerCase();
  for (const forbidden of [KEY, MODEL_ID, BODY_MARKER, "<repo_file", "openrouter", "anthropic"]) {
    expect(text).not.toContain(forbidden.toLowerCase());
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ai step budget (D-35 (a))", () => {
  it.each([
    [100_000, 105_000],
    [55_000, 60_000],
    [200_000, 110_000],
  ])("model timeoutMs %s → step budget %s", (timeoutMs, budget) => {
    expect(aiStepBudgetMs({ model: createFakeModel({ timeoutMs }) })).toBe(budget);
  });

  it("an explicit aiStepTimeoutMs wins; no model → Anthropic default + margin", () => {
    expect(aiStepBudgetMs({ model: createFakeModel({ timeoutMs: 100_000 }), aiStepTimeoutMs: 7 })).toBe(7);
    expect(aiStepBudgetMs({ model: null })).toBe(60_000);
  });

  it("the worker arms the ai step timer with the derived budget", async () => {
    const { db, deps } = setup(createFakeModel({ timeoutMs: 100_000 }));
    await runToAi(deps, db);
    const spy = vi.spyOn(globalThis, "setTimeout");
    await runOnce(deps);
    expect(spy.mock.calls.map((call) => call[1])).toContain(105_000);
  });
});

describe("AI_UNAVAILABLE retry rules (D-35 (d)) and the ai.failed log (D-35 (b))", () => {
  it("retryable failure on try 1 re-queues with backoff; a second failure ends AI_UNAVAILABLE", async () => {
    const model = createFakeModel({
      script: [new ModelProviderError("http", 429, true), new ModelProviderError("timeout", null, true)],
    });
    const { clock, db, deps, logs } = setup(model);
    await runToAi(deps, db);
    const before = snapshot(db);
    const progressBefore = db.analysis.progress;
    expect(progressBefore).toBeGreaterThanOrEqual(70);

    const first = await runOnce(deps);
    expect(first.outcome).toBe("retry");
    expect(db.job).toMatchObject({ status: "queued", step: "ai", last_error_code: "AI_UNAVAILABLE" });
    expect(Date.parse(db.job.run_after) - clock.now().getTime()).toBe(backoffMs(1));
    expect(backoffMs(1)).toBe(30_000);

    clock.ms = Date.parse(db.job.run_after);
    const second = await runOnce(deps);
    expect(second.outcome).toBe("failed");
    expect(model.calls).toHaveLength(2);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
    expect(db.analysis.progress).toBeGreaterThanOrEqual(70);
    expect(snapshot(db)).toEqual(before);
    expect(db.findings.length).toBeGreaterThan(0);
    expect(db.usage).toHaveLength(0);

    const lines = aiFailed(logs);
    expect(lines).toHaveLength(2);
    lines.forEach(expectSafeLog);
    expect(lines[0]).toMatchObject({ jobId: db.job.id, attempt: 1, reason: "http", status: 429 });
    expect(lines[1]).toMatchObject({ jobId: db.job.id, attempt: 2, reason: "timeout", status: null });
  });

  it("404 on try 1 ends AI_UNAVAILABLE at once with one call", async () => {
    const model = createFakeModel({ script: [new ModelProviderError("http", 404, false)] });
    const { db, deps, logs } = setup(model);
    await runToAi(deps, db);
    const before = snapshot(db);
    const result = await runOnce(deps);
    expect(result.outcome).toBe("failed");
    expect(model.calls).toHaveLength(1);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
    expect(db.job).toMatchObject({ status: "failed", last_error_code: "AI_UNAVAILABLE", state: {} });
    expect(db.analysis.progress).toBeGreaterThanOrEqual(70);
    expect(snapshot(db)).toEqual(before);
    const lines = aiFailed(logs);
    expect(lines).toHaveLength(1);
    expectSafeLog(lines[0] ?? {});
    expect(lines[0]).toMatchObject({ attempt: 1, reason: "http", status: 404 });
  });

  it("a non-provider error from analyze keeps INTERNAL and logs reason internal", async () => {
    const model = createFakeModel({ script: [new Error(`oops ${KEY}`), new Error("again")] });
    const { clock, db, deps, logs } = setup(model);
    await runToAi(deps, db);
    await runOnce(deps);
    expect(db.job.last_error_code).toBe("INTERNAL");
    clock.ms = Date.parse(db.job.run_after);
    await runOnce(deps);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "INTERNAL" });
    const lines = aiFailed(logs);
    expect(lines).toHaveLength(2);
    lines.forEach(expectSafeLog);
    expect(lines.map((line) => line.reason)).toEqual(["internal", "internal"]);
  });

  it("unparseable output logs invalid_output once (MODEL_OUTPUT_INVALID, not retried)", async () => {
    const model = createFakeModel({ script: [`not json ${BODY_MARKER}`] });
    const { db, deps, logs } = setup(model);
    await runToAi(deps, db);
    await runOnce(deps);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "MODEL_OUTPUT_INVALID" });
    const lines = aiFailed(logs);
    expect(lines).toHaveLength(1);
    expectSafeLog(lines[0] ?? {});
    expect(lines[0]).toMatchObject({ reason: "invalid_output", status: null });
  });
});

describe("empty model output → MODEL_OUTPUT_INVALID (D-35 (c))", () => {
  const json = (body: unknown): FetchLike => async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it.each<[string, AnalysisModel]>([
    ["openrouter content null", createOpenRouterModel({ apiKey: KEY, model: MODEL_ID, fetch: json({ choices: [{ message: { content: null } }] }) })],
    ["openrouter content missing", createOpenRouterModel({ apiKey: KEY, model: MODEL_ID, fetch: json({ choices: [{ message: {} }], usage: { prompt_tokens: 9, completion_tokens: 0 } }) })],
    ["openrouter content whitespace", createOpenRouterModel({ apiKey: KEY, model: MODEL_ID, fetch: json({ choices: [{ message: { content: "   " } }] }) })],
    ["anthropic zero text blocks", createAnthropicModel({ apiKey: KEY, model: MODEL_ID, fetch: json({ content: [{ type: "thinking" }], usage: { input_tokens: 9, output_tokens: 3 } }) })],
  ])("%s → failed / MODEL_OUTPUT_INVALID, one call, one usage row, no retry", async (_label, adapter) => {
    const spy: Spy = { calls: 0 };
    const { clock, db, deps, logs } = setup(counted(adapter, spy));
    await runToAi(deps, db);
    const before = snapshot(db);
    const result = await runOnce(deps);
    expect(result.outcome).toBe("failed");
    // Nothing is left to run.
    clock.ms += 10 * 60_000;
    expect((await runOnce(deps)).outcome).toBe("idle");
    expect(spy.calls).toBe(1);
    expect(db.usage).toHaveLength(1);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "MODEL_OUTPUT_INVALID" });
    expect(db.job).toMatchObject({ status: "failed", last_error_code: "MODEL_OUTPUT_INVALID" });
    expect(snapshot(db)).toEqual(before);
    const lines = aiFailed(logs);
    expect(lines).toHaveLength(1);
    expectSafeLog(lines[0] ?? {});
    expect(lines[0]).toMatchObject({ reason: "empty_content", status: null, attempt: 1 });
  });
});
