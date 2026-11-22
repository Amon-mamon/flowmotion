// @vitest-environment node
/**
 * Phase 2b (D-24, D-33 / S2R-2): provider selection, the runner guard, the
 * single provider switch, both call sites, and the OpenRouter adapter.
 * Stubbed fetch only: no network, no real keys.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { AI_PROVIDER_REFUSED, resolveModelConfig, type ModelEnvSource } from "@/lib/analysis/model/config";
import { createOpenRouterModel, OPENROUTER_CHAT_URL } from "@/lib/analysis/model/openrouter";
import { ModelProviderError } from "@/lib/analysis/model/types";
import { createModelFromEnv } from "@/lib/jobs/runtime";

const OR_KEY = "sk-or-v1-test-key-not-real-0001";
const OR_MODEL = "vendor/test-model:free";
const AN_KEY = "sk-ant-test-key-not-real-0001";

const OPENROUTER_ENV: ModelEnvSource = {
  ANALYSIS_PROVIDER: "openrouter",
  ANALYSIS_MODEL: OR_MODEL,
  OPENROUTER_API_KEY: OR_KEY,
  APP_URL: "http://localhost:3000",
};

const ANTHROPIC_ENV: ModelEnvSource = {
  ANALYSIS_PROVIDER: "anthropic",
  ANALYSIS_MODEL: "claude-test",
  ANTHROPIC_API_KEY: AN_KEY,
};

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

function refusalLogs(): unknown[][] {
  return warn.mock.calls.filter((args) => args.some((arg) => String(arg).includes(AI_PROVIDER_REFUSED)));
}

function expectNoValuesLogged() {
  const logged = JSON.stringify(warn.mock.calls);
  for (const value of [OR_KEY, OR_MODEL, AN_KEY, "localhost", "flowmotion.app", "production"]) {
    expect(logged).not.toContain(value);
  }
}

describe("resolveModelConfig: provider matrix", () => {
  it.each<[string, ModelEnvSource]>([
    ["no provider", { ANALYSIS_MODEL: "m", ANTHROPIC_API_KEY: AN_KEY }],
    ["provider disabled", { ...ANTHROPIC_ENV, ANALYSIS_PROVIDER: "disabled" }],
    ["unknown provider", { ...ANTHROPIC_ENV, ANALYSIS_PROVIDER: "gemini" }],
    ["provider with different case", { ...ANTHROPIC_ENV, ANALYSIS_PROVIDER: "Anthropic" }],
    ["anthropic, missing key", { ...ANTHROPIC_ENV, ANTHROPIC_API_KEY: undefined }],
    ["anthropic, blank key", { ...ANTHROPIC_ENV, ANTHROPIC_API_KEY: "  " }],
    ["anthropic, only the OpenRouter key", { ...ANTHROPIC_ENV, ANTHROPIC_API_KEY: undefined, OPENROUTER_API_KEY: OR_KEY }],
    ["anthropic, ANALYSIS_MODEL=disabled", { ...ANTHROPIC_ENV, ANALYSIS_MODEL: "disabled" }],
    ["openrouter, missing key", { ...OPENROUTER_ENV, OPENROUTER_API_KEY: undefined }],
    ["openrouter, only the Anthropic key", { ...OPENROUTER_ENV, OPENROUTER_API_KEY: undefined, ANTHROPIC_API_KEY: AN_KEY }],
    ["openrouter, ANALYSIS_MODEL=disabled", { ...OPENROUTER_ENV, ANALYSIS_MODEL: "DISABLED" }],
    ["openrouter, missing ANALYSIS_MODEL", { ...OPENROUTER_ENV, ANALYSIS_MODEL: undefined }],
  ])("%s → disabled", (_name, env) => {
    expect(resolveModelConfig(env, "local")).toEqual({ enabled: false });
    // R2b-2 / D-34 (b): a missing key or a disabled model is the ordinary off
    // state, not a refusal, so nothing is logged (including for openrouter).
    expect(refusalLogs()).toHaveLength(0);
  });

  it("anthropic → enabled for both runners (the guard is OpenRouter-only)", () => {
    const expected = { enabled: true, provider: "anthropic", model: "claude-test", apiKey: AN_KEY };
    expect(resolveModelConfig(ANTHROPIC_ENV, "local")).toEqual(expected);
    expect(resolveModelConfig(ANTHROPIC_ENV, "edge")).toEqual(expected);
    expect(resolveModelConfig({ ...ANTHROPIC_ENV, NODE_ENV: "production", APP_URL: "https://flowmotion.app" }, "edge")).toEqual(expected);
    expect(refusalLogs()).toHaveLength(0);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "openrouter, runner local, APP_URL %s → enabled",
    (appUrl) => {
      expect(resolveModelConfig({ ...OPENROUTER_ENV, APP_URL: appUrl }, "local")).toEqual({
        enabled: true,
        provider: "openrouter",
        model: OR_MODEL,
        apiKey: OR_KEY,
      });
      expect(refusalLogs()).toHaveLength(0);
    },
  );

  it.each<[string, ModelEnvSource]>([
    ["NODE_ENV=production", { ...OPENROUTER_ENV, NODE_ENV: "production" }],
    ["APP_URL https://flowmotion.app", { ...OPENROUTER_ENV, APP_URL: "https://flowmotion.app" }],
    ["missing APP_URL", { ...OPENROUTER_ENV, APP_URL: undefined }],
    ["unparsable APP_URL", { ...OPENROUTER_ENV, APP_URL: "localhost:3000/x y" }],
    ["localhost as a subdomain", { ...OPENROUTER_ENV, APP_URL: "http://localhost.flowmotion.app" }],
  ])("openrouter, runner local, %s → refused, one code-only log", (_name, env) => {
    expect(resolveModelConfig(env, "local")).toEqual({ enabled: false });
    expect(refusalLogs()).toHaveLength(1);
    expectNoValuesLogged();
  });
});

describe("edge refusal (S2R-2, D-33)", () => {
  it("complete OpenRouter env with runner edge → disabled, exactly one AI_PROVIDER_REFUSED log, no values", () => {
    expect(OPENROUTER_ENV.NODE_ENV).toBeUndefined();
    expect(resolveModelConfig(OPENROUTER_ENV, "edge")).toEqual({ enabled: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(refusalLogs()).toHaveLength(1);
    const args = JSON.stringify(warn.mock.calls[0]);
    expect(args).not.toContain(OR_KEY);
    expect(args).not.toContain(OR_MODEL);
  });

  it.each<[string, ModelEnvSource]>([
    ["only ANALYSIS_PROVIDER=openrouter", { ANALYSIS_PROVIDER: "openrouter" }],
    ["key present, ANALYSIS_MODEL=disabled", { ANALYSIS_PROVIDER: "openrouter", OPENROUTER_API_KEY: OR_KEY, ANALYSIS_MODEL: "disabled" }],
  ])("R2b-5: runner edge with an incomplete env (%s) → disabled, exactly one AI_PROVIDER_REFUSED log", (_name, env) => {
    expect(resolveModelConfig(env, "edge")).toEqual({ enabled: false });
    expect(refusalLogs()).toHaveLength(1);
    expectNoValuesLogged();
  });

  it("R2b-5: runner is a required argument (type-level pin)", () => {
    const env: ModelEnvSource = { ANALYSIS_PROVIDER: "openrouter" };
    // @ts-expect-error runner is required, there is no default (D-33).
    expect(resolveModelConfig(env)).toEqual({ enabled: false });
  });

  it("createModelFromEnv(sameEnv, \"edge\", stubFetch) → null and fetch is never called", () => {
    const stubFetch = vi.fn(async () => new Response("{}"));
    expect(createModelFromEnv(OPENROUTER_ENV, "edge", stubFetch)).toBeNull();
    expect(stubFetch).not.toHaveBeenCalled();
    expect(refusalLogs()).toHaveLength(1);
  });

  it("anthropic with runner edge still builds a working model", async () => {
    const stubFetch = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "[]" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }),
    );
    const model = createModelFromEnv(ANTHROPIC_ENV, "edge", stubFetch);
    expect(model).not.toBeNull();
    await model?.analyze({ system: "s", prompt: "p", maxOutputTokens: 10 });
    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(String((stubFetch.mock.calls[0] as unknown[])[0])).toContain("api.anthropic.com");
  });
});

describe("createModelFromEnv: the single provider switch", () => {
  it("local runner + OpenRouter env → OpenRouter adapter", async () => {
    const stubFetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "[]" } }] }), { status: 200 }),
    );
    const model = createModelFromEnv(OPENROUTER_ENV, "local", stubFetch);
    expect(model).not.toBeNull();
    await model?.analyze({ system: "s", prompt: "p", maxOutputTokens: 10 });
    expect((stubFetch.mock.calls[0] as unknown[])[0]).toBe(OPENROUTER_CHAT_URL);
  });

  it("disabled env → null without fetch", () => {
    const stubFetch = vi.fn(async () => new Response("{}"));
    expect(createModelFromEnv({}, "local", stubFetch)).toBeNull();
    expect(stubFetch).not.toHaveBeenCalled();
  });
});

describe("call sites (source checks)", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("the worker Edge Function passes \"edge\" and has no \"local\" literal", () => {
    const source = read("supabase/functions/worker/index.ts");
    expect(source).toMatch(/createModelFromEnv\(.*,\s*"edge"\s*\)/);
    expect(source).not.toContain('"local"');
    expect(source).not.toContain("'local'");
  });

  it("the local runner passes \"local\"", () => {
    const source = read("src/server/jobs/local-runner.ts");
    expect(source).toMatch(/createModelFromEnv\(.*,\s*"local"\s*\)/);
    expect(source).not.toContain('"edge"');
  });

  it("only runtime.ts builds adapters; only config.ts reads the provider env names", () => {
    const files = [
      "src/server/jobs/local-runner.ts",
      "supabase/functions/worker/index.ts",
      "src/lib/jobs/worker.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/createOpenRouterModel|createAnthropicModel/);
      expect(source, file).not.toMatch(/OPENROUTER_API_KEY|ANALYSIS_PROVIDER/);
    }
  });
});

describe("OpenRouter adapter (stubbed fetch)", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const input = { system: "SYSTEM", prompt: "PROMPT TEXT", maxOutputTokens: 321 };

  it("sends the documented request and parses the response", async () => {
    const fetchMock = vi.fn(async () =>
      ok({ id: "x", choices: [{ message: { role: "assistant", content: "[{}]" } }, { message: { content: "ignored" } }], usage: { prompt_tokens: 40, completion_tokens: 7 } }),
    );
    const model = createOpenRouterModel({ apiKey: OR_KEY, model: OR_MODEL, fetch: fetchMock });
    const out = await model.analyze(input);
    expect(out).toEqual({ text: "[{}]", tokensIn: 40, tokensOut: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: `Bearer ${OR_KEY}`, "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: OR_MODEL,
      max_tokens: 321,
      messages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "PROMPT TEXT" },
      ],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("missing usage → ceil(chars / 3) of prompt and text", async () => {
    const model = createOpenRouterModel({ apiKey: OR_KEY, model: OR_MODEL, fetch: async () => ok({ choices: [{ message: { content: "abcd" } }] }) });
    const out = await model.analyze(input);
    expect(out.tokensIn).toBe(Math.ceil(("SYSTEM".length + "PROMPT TEXT".length) / 3));
    expect(out.tokensOut).toBe(2);
  });

  it("the caller's abort signal aborts the request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort();
      if (init?.signal?.aborted === true) throw new DOMException("aborted", "AbortError");
      return ok({ choices: [{ message: { content: "" } }] });
    });
    const model = createOpenRouterModel({ apiKey: OR_KEY, model: OR_MODEL, fetch: fetchMock });
    await expect(model.analyze({ ...input, signal: controller.signal })).rejects.toMatchObject({ retryable: true, status: null });
  });

  it.each<[string, unknown]>([
    ["2xx body with an error object", { error: { code: 429, message: `rate limited ${OR_KEY}` } }],
    ["empty choices", { choices: [] }],
    ["shape mismatch", { choices: [{ message: { content: 5 } }] }],
  ])("%s → retryable ModelProviderError", async (_name, body) => {
    const model = createOpenRouterModel({ apiKey: OR_KEY, model: OR_MODEL, fetch: async () => ok(body) });
    const error = await model.analyze(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelProviderError);
    expect((error as ModelProviderError).retryable).toBe(true);
    expect((error as Error).message).not.toContain(OR_KEY);
    expect((error as Error).message).not.toContain("rate limited");
  });

  it("non-JSON 2xx body → retryable ModelProviderError", async () => {
    const model = createOpenRouterModel({ apiKey: OR_KEY, model: OR_MODEL, fetch: async () => new Response("<html>", { status: 200 }) });
    await expect(model.analyze(input)).rejects.toMatchObject({ name: "ModelProviderError", retryable: true });
  });

  it("network failure → retryable, status null", async () => {
    const model = createOpenRouterModel({ apiKey: OR_KEY, model: OR_MODEL, fetch: async () => { throw new Error(`boom ${OR_KEY}`); } });
    const error = await model.analyze(input).catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: true, status: null });
    expect((error as Error).message).not.toContain(OR_KEY);
  });

  it.each([
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [402, false],
    [404, false],
  ])("HTTP %s → status carried, retryable=%s, key never in the message", async (status, retryable) => {
    const model = createOpenRouterModel({
      apiKey: OR_KEY,
      model: OR_MODEL,
      fetch: async () => ok({ error: { message: `bad key ${OR_KEY}` } }, status),
    });
    const error = await model.analyze(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelProviderError);
    expect((error as ModelProviderError).status).toBe(status);
    expect((error as ModelProviderError).retryable).toBe(retryable);
    expect((error as Error).message).not.toContain(OR_KEY);
    expect((error as Error).message).not.toContain("bad key");
  });
});
