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
import { aiCallTimeoutMs, aiStepBudgetMs, backoffMs, runOnce } from "@/lib/jobs/worker";

import { FakeClock, FakeWorkerDb, FakeGitHub } from "./fakes";

const KEY = "sk-test-key-not-real-PHASE2C-0002";
const MODEL_ID = "vendor/marker-model-id:free";
const BODY_MARKER = "BODY_MARKER_c41d";
/** R2c-3: repository content that reaches the prompt and must never reach a log line. */
const PROMPT_MARKER = "FM_PROMPT_MARKER_7c1e";

const REPO: Record<string, string> = {
  "package.json": JSON.stringify({ dependencies: { next: "16", stripe: "1" } }),
  "src/app/api/webhooks/stripe/route.ts":
    `const token = "ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}";\nexport async function POST(req) { stripe.webhooks.constructEvent(b, s, k); return 1; }\n// ${PROMPT_MARKER}\n`,
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
  for (const forbidden of [KEY, MODEL_ID, BODY_MARKER, PROMPT_MARKER, "<repo_file", "openrouter", "anthropic"]) {
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
    // R2c-3: the marker reached the prompt, so its absence from the log lines below means something.
    expect(model.calls[0]?.prompt).toContain(PROMPT_MARKER);
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

/** A fetch that never answers; it rejects only when its signal aborts (like a real hung request). */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === undefined || signal === null) return;
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

/** A model that ignores its signal and settles only after `afterMs` (fake timers). */
function lateModel(afterMs: number, settle: "resolve" | "reject", calls: { n: number }): AnalysisModel {
  return {
    timeoutMs: 55_000,
    analyze: () =>
      new Promise((resolve, reject) => {
        calls.n += 1;
        setTimeout(() => {
          if (settle === "reject") reject(new ModelProviderError("timeout", null, true));
          else resolve({ text: JSON.stringify([]), tokensIn: 10, tokensOut: 2 });
        }, afterMs);
      }),
  };
}

describe("model call deadline inside the ai step (D-36 (d), R2c-2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deadline = max(budget - 5 s, floor(budget / 2))", () => {
    expect(aiCallTimeoutMs(110_000)).toBe(105_000);
    expect(aiCallTimeoutMs(60_000)).toBe(55_000);
    expect(aiCallTimeoutMs(1_000)).toBe(500);
    expect(aiCallTimeoutMs(7)).toBe(3);
  });

  it.each([
    ["timeoutMs 200 000 (budget 110 000, deadline 105 000)", undefined, 105_000],
    ["aiStepTimeoutMs 1 000 (deadline 500)", 1_000, 500],
  ])("%s: a slow model ends AI_UNAVAILABLE with reason timeout, never INTERNAL", async (_label, override, deadline) => {
    const adapter = createOpenRouterModel({ apiKey: KEY, model: MODEL_ID, fetch: hangingFetch, timeoutMs: 200_000 });
    const spy: Spy = { calls: 0 };
    const { clock, db, deps, logs } = setup(counted(adapter, spy));
    if (override !== undefined) deps.aiStepTimeoutMs = override;
    await runToAi(deps, db);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const first = runOnce(deps);
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(aiFailed(logs)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await first).outcome).toBe("retry");
    expect(db.job.last_error_code).toBe("AI_UNAVAILABLE");

    clock.ms = Date.parse(db.job.run_after);
    const second = runOnce(deps);
    await vi.advanceTimersByTimeAsync(deadline);
    expect((await second).outcome).toBe("failed");
    // Run any timer left over: a late step timer must not add anything.
    await vi.advanceTimersByTimeAsync(200_000);

    expect(spy.calls).toBe(2);
    expect(db.analysis).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
    expect(logs.filter((line) => line.event === "job.retry").map((line) => line.fields.code)).toEqual(["AI_UNAVAILABLE"]);
    const lines = aiFailed(logs);
    expect(lines).toHaveLength(2);
    lines.forEach(expectSafeLog);
    expect(lines.map((line) => [line.attempt, line.reason, line.status])).toEqual([
      [1, "timeout", null],
      [2, "timeout", null],
    ]);
  });

  it("a step aborted by the step timer is INTERNAL and writes no ai.failed line", async () => {
    const calls = { n: 0 };
    const { db, deps, logs } = setup(lateModel(1_500, "reject", calls));
    deps.aiStepTimeoutMs = 1_000;
    await runToAi(deps, db);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const run = runOnce(deps);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await run).outcome).toBe("retry");
    expect(db.job.last_error_code).toBe("INTERNAL");
    // The orphaned call settles after the step ended: still no line.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.n).toBe(1);
    expect(aiFailed(logs)).toHaveLength(0);
  });

  it("insertUsageEvent throwing is INTERNAL and writes no ai.failed line", async () => {
    const { db, deps, logs } = setup(createFakeModel());
    await runToAi(deps, db);
    vi.spyOn(db, "insertUsageEvent").mockRejectedValue(new Error("db down"));
    const result = await runOnce(deps);
    expect(result.outcome).toBe("retry");
    expect(db.job.last_error_code).toBe("INTERNAL");
    expect(aiFailed(logs)).toHaveLength(0);
  });
});

describe("usage row before the abort check (R2c-5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a response that arrives after the step signal aborted is still logged, and nothing else is written", async () => {
    const calls = { n: 0 };
    const { db, deps, logs } = setup(lateModel(1_200, "resolve", calls));
    deps.aiStepTimeoutMs = 1_000;
    await runToAi(deps, db);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const run = runOnce(deps);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await run).outcome).toBe("retry");
    const analysisWrites = vi.spyOn(db, "updateAnalysis");
    const jobWrites = vi.spyOn(db, "updateJob");
    const recWrites = vi.spyOn(db, "replaceRecommendations");
    const analysisBefore = JSON.stringify(db.analysis);
    const jobBefore = JSON.stringify(db.job);

    await vi.advanceTimersByTimeAsync(500);
    expect(calls.n).toBe(1);
    expect(db.usage).toHaveLength(1);
    expect(analysisWrites).not.toHaveBeenCalled();
    expect(jobWrites).not.toHaveBeenCalled();
    expect(recWrites).not.toHaveBeenCalled();
    expect(JSON.stringify(db.analysis)).toBe(analysisBefore);
    expect(JSON.stringify(db.job)).toBe(jobBefore);
    expect(aiFailed(logs)).toHaveLength(0);
  });
});
