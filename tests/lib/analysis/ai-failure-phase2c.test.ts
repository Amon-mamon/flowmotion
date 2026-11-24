// @vitest-environment node
/**
 * Phase 2c (D-35): adapter timeouts and failure reasons. Stubbed fetch only:
 * no network, no real keys.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANTHROPIC_TIMEOUT_MS, createAnthropicModel } from "@/lib/analysis/model/anthropic";
import type { FetchLike } from "@/lib/analysis/model/http";
import { createOpenRouterModel, OPENROUTER_TIMEOUT_MS } from "@/lib/analysis/model/openrouter";
import { ModelProviderError, type AnalysisModel, type ModelFailureReason } from "@/lib/analysis/model/types";
import { createModelFromEnv } from "@/lib/jobs/runtime";
import { AI_STEP_MARGIN_MS, AI_STEP_MAX_MS, STALE_LOCK_MS } from "@/lib/jobs/worker";
import { analysisSchema } from "@/schemas/analysis";
import { JOB_ERROR_CODES, jobErrorCodeSchema } from "@/schemas/api";

const KEY = "sk-test-key-not-real-PHASE2C-0001";
const MODEL_ID = "vendor/marker-model-id:free";
const BODY_MARKER = "BODY_MARKER_7f3a";
const PROMPT_MARKER = "PROMPT_MARKER_91c2";

type Build = (fetch: FetchLike, timeoutMs?: number) => AnalysisModel;

const ADAPTERS: [string, Build][] = [
  ["openrouter", (fetch, timeoutMs) => createOpenRouterModel({ apiKey: KEY, model: MODEL_ID, fetch, ...(timeoutMs !== undefined ? { timeoutMs } : {}) })],
  ["anthropic", (fetch, timeoutMs) => createAnthropicModel({ apiKey: KEY, model: MODEL_ID, fetch, ...(timeoutMs !== undefined ? { timeoutMs } : {}) })],
];

const input = { system: "SYSTEM", prompt: `prompt ${PROMPT_MARKER}`, maxOutputTokens: 10 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that never resolves until its signal aborts, then rejects like the platform fetch. */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

async function failure(model: AnalysisModel, signal?: AbortSignal): Promise<ModelProviderError> {
  const error = await model.analyze(signal === undefined ? input : { ...input, signal }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ModelProviderError);
  const providerError = error as ModelProviderError;
  for (const text of [providerError.message, String(providerError)]) {
    for (const forbidden of [KEY, MODEL_ID, BODY_MARKER, PROMPT_MARKER]) expect(text).not.toContain(forbidden);
  }
  return providerError;
}

function expectReason(error: ModelProviderError, reason: ModelFailureReason, status: number | null, retryable: boolean) {
  expect({ reason: error.reason, status: error.status, retryable: error.retryable }).toEqual({ reason, status, retryable });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("timeouts and the ai step budget (D-35 (a))", () => {
  it("constants and the budget invariant", () => {
    expect(OPENROUTER_TIMEOUT_MS).toBe(100_000);
    expect(ANTHROPIC_TIMEOUT_MS).toBe(55_000);
    expect(OPENROUTER_TIMEOUT_MS + AI_STEP_MARGIN_MS).toBeLessThanOrEqual(AI_STEP_MAX_MS);
    expect(AI_STEP_MAX_MS).toBeLessThanOrEqual(STALE_LOCK_MS - 10_000);
  });

  it("createModelFromEnv adapters expose 100 000 (openrouter) and 55 000 (anthropic)", () => {
    const stub: FetchLike = async () => json({});
    const openrouter = createModelFromEnv(
      { ANALYSIS_PROVIDER: "openrouter", ANALYSIS_MODEL: MODEL_ID, OPENROUTER_API_KEY: KEY, APP_URL: "http://localhost:3000" },
      "local",
      stub,
    );
    const anthropic = createModelFromEnv(
      { ANALYSIS_PROVIDER: "anthropic", ANALYSIS_MODEL: "claude-test", ANTHROPIC_API_KEY: KEY },
      "edge",
      stub,
    );
    expect(openrouter?.timeoutMs).toBe(100_000);
    expect(anthropic?.timeoutMs).toBe(55_000);
  });

  it("an explicit timeoutMs option is the adapter's effective timeout", () => {
    for (const [, build] of ADAPTERS) expect(build(async () => json({}), 1234).timeoutMs).toBe(1234);
  });
});

describe.each(ADAPTERS)("%s adapter failure reasons (D-35)", (name, build) => {
  it("own timer abort → timeout, retryable", async () => {
    const error = await failure(build(hangingFetch, 20));
    expectReason(error, "timeout", null, true);
  });

  it("caller abort → timeout, retryable", async () => {
    const controller = new AbortController();
    const model = build(hangingFetch);
    const pending = failure(model, controller.signal);
    controller.abort();
    expectReason(await pending, "timeout", null, true);
  });

  it("fetch rejects with TypeError → network, retryable", async () => {
    const error = await failure(build(async () => { throw new TypeError(`fetch failed ${KEY} ${BODY_MARKER}`); }));
    expectReason(error, "network", null, true);
  });

  it.each([
    [429, true],
    [503, true],
    [408, true],
    [400, false],
    [401, false],
    [404, false],
  ])("HTTP %s → http, retryable=%s", async (status, retryable) => {
    const error = await failure(build(async () => json({ error: { message: `${BODY_MARKER} ${MODEL_ID}` } }, status)));
    expectReason(error, "http", status, retryable);
  });

  it("2xx non-JSON body → not_json, retryable", async () => {
    const error = await failure(build(async () => new Response(`<html>${BODY_MARKER}</html>`, { status: 200 })));
    expectReason(error, "not_json", 200, true);
  });

  it("aborted while reading the body → timeout", async () => {
    const controller = new AbortController();
    const fetchStub: FetchLike = async () => {
      const response = new Response("{}", { status: 200 });
      // Simulates the platform rejecting `json()` because the signal aborted mid-body.
      vi.spyOn(response, "json").mockImplementation(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      });
      return response;
    };
    const error = await failure(build(fetchStub), controller.signal);
    expectReason(error, "timeout", 200, true);
  });

  it("wrong envelope shape → bad_shape, retryable", async () => {
    const error = await failure(build(async () => json({ unexpected: BODY_MARKER })));
    expectReason(error, "bad_shape", 200, true);
  });

  if (name === "openrouter") {
    it("2xx with an error object → error_body, retryable", async () => {
      const error = await failure(build(async () => json({ error: { code: 429, message: `${BODY_MARKER} ${KEY}` } })));
      expectReason(error, "error_body", 200, true);
    });

    it.each<[string, unknown]>([
      ["null", { choices: [{ message: { content: null } }] }],
      ["missing", { choices: [{ message: { role: "assistant" } }] }],
      ["whitespace", { choices: [{ message: { content: "   " } }] }],
    ])("content %s → no error, text is empty after trim", async (_label, body) => {
      const out = await build(async () => json(body)).analyze(input);
      expect(out.text.trim()).toBe("");
    });
  }
});

describe("AI_UNAVAILABLE in the shared schema (D-35 (d))", () => {
  it("is a job error code and analysisSchema accepts it", () => {
    expect(JOB_ERROR_CODES).toContain("AI_UNAVAILABLE");
    expect(jobErrorCodeSchema.parse("AI_UNAVAILABLE")).toBe("AI_UNAVAILABLE");
    const dto = analysisSchema.parse({
      id: "8f2a1c3e-4b5d-4e6f-8a7b-9c0d1e2f3a4b",
      projectId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      status: "failed",
      progress: 75,
      branch: "main",
      commitSha: null,
      validation: null,
      counts: {
        filesConsidered: 0,
        filesRead: 0,
        filesBlocked: 0,
        filesBlockedByReason: { denied: 0, extension: 0, size: 0, cap: 0 },
        filesSkippedBudget: 0,
      },
      signals: [],
      errorCode: "AI_UNAVAILABLE",
      startedAt: null,
      finishedAt: null,
    });
    expect(dto.errorCode).toBe("AI_UNAVAILABLE");
  });
});
