// @vitest-environment node
/**
 * Phase 3b generation job (contract section 4, D-40, D-59): context →
 * ai → compile → validate → persist with the fake generation model, the
 * 3-started-calls cap, provider failures, unusable output feedback,
 * AI_DISABLED, the context step's path policy / scanner / caps, and the
 * `ai.failed` log shape. Fakes only, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeModel } from "@/lib/analysis/model/fake";
import { ModelProviderError, type AnalysisModel } from "@/lib/analysis/model/types";
import { compileFlow } from "@/lib/compiler";
import { createFakeGenerationModel, deriveFlowSpecDraft } from "@/lib/generation/fake";
import { MAX_RESPONSE_CHARS } from "@/lib/generation/parse";
import { createModelFromEnv } from "@/lib/jobs/runtime";
import { generateStateSchema, type WorkerDeps } from "@/lib/jobs/types";
import { runOnce } from "@/lib/jobs/worker";
import { CATALOG_VERSION, N8N_VERSION } from "@/lib/n8n-catalog/version";
import { validateWorkflow } from "@/lib/validator";
import { flowSpecSchema } from "@/schemas/flowspec";

import { ANALYSIS, FakeClock, FakeGitHub, FakeWorkerDb, FLOW, REPO_ID, USER } from "./fakes";

const SECRET = `ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}`;
const PROMPT_MARKER = "FM_GEN_PROMPT_MARKER_51ab";

const REPO: Record<string, string> = {
  "src/app/api/orders/route.ts": `const token = "${SECRET}";\nexport async function POST(req) { return Response.json({ ok: 1 }); }\n// ${PROMPT_MARKER}\n`,
  "src/lib/slack.ts": "export const channel = process.env.SLACK_CHANNEL;\n",
  ".env": "SLACK_TOKEN=xoxb-not-real\n",
};

type LogLine = { event: string; fields: Record<string, unknown> };

function setup(
  model: AnalysisModel | null,
  options: Parameters<FakeWorkerDb["seedGeneration"]>[0] = {},
  files: Record<string, string> = REPO,
) {
  const clock = new FakeClock();
  const db = new FakeWorkerDb(clock);
  db.seedGeneration({ sourceFiles: ["src/app/api/orders/route.ts"], ...options });
  const github = new FakeGitHub(files);
  const logs: LogLine[] = [];
  const deps: WorkerDeps = {
    db,
    github,
    model,
    now: clock.now,
    workerId: "test-worker",
    log: (event, fields) => logs.push({ event, fields }),
  };
  return { clock, db, github, deps, logs };
}

/** Runs the job until it ends (advancing the clock past any backoff). */
async function drain(deps: WorkerDeps, db: FakeWorkerDb, clock: FakeClock, max = 40) {
  for (let i = 0; i < max; i += 1) {
    if (db.job.status === "done" || db.job.status === "failed") return;
    const result = await runOnce(deps);
    if (result.outcome === "idle") clock.advance(300_000);
  }
}

const valid = (prompt = "") => JSON.stringify(deriveFlowSpecDraft(prompt));
const INVALID = JSON.stringify({ version: 1, name: "x" });
const retryable = () => new ModelProviderError("http", 503, true);

afterEach(() => vi.restoreAllMocks());

describe("generation job: happy path", () => {
  it("fake model → ready; n8n_json equals compileFlow(stored spec) and passes the validator; one usage row; state empty", async () => {
    const model = createFakeGenerationModel();
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);

    expect(db.job.status).toBe("done");
    expect(db.job.state).toEqual({});
    const flow = db.flow;
    expect(flow.status).toBe("ready");
    expect(flow.error_code).toBeNull();
    const spec = flowSpecSchema.parse(flow.flow_spec);
    expect(flow.name).toBe(spec.name);
    const compiled = compileFlow(spec);
    expect(flow.n8n_json).toEqual(compiled.workflow);
    expect(flow.setup_checklist).toEqual(compiled.checklist);
    expect(validateWorkflow(flow.n8n_json, flow.setup_checklist)).toEqual({ ok: true });
    expect(flow.catalog_version).toBe(CATALOG_VERSION);
    expect(flow.n8n_version).toBe(N8N_VERSION);
    expect(model.calls).toHaveLength(1);
    expect(db.usage).toEqual([
      expect.objectContaining({ userId: USER, kind: "generation", refId: FLOW }),
    ]);
  });

  it("invalid draft twice then valid → ready with 3 calls and 3 usage rows", async () => {
    const model = createFakeGenerationModel({ script: [INVALID, "no json here"] });
    const { db, deps, clock, logs } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("ready");
    expect(model.calls).toHaveLength(3);
    expect(db.usage).toHaveLength(3);
    // The retries carry our rule ids in <previous_errors>, never model text.
    expect(model.calls[1]?.prompt).toContain("<previous_errors>");
    expect(model.calls[1]?.prompt).toContain("- SCHEMA");
    expect(model.calls[2]?.prompt).toContain("- NO_JSON");
    expect(model.calls[2]?.prompt).not.toContain("no json here");
    expect(logs.filter((line) => line.event === "ai.failed").map((line) => line.fields.reason)).toEqual([
      "invalid_output",
      "invalid_output",
    ]);
  });

  it("three invalid drafts → failed / GENERATION_EXHAUSTED after exactly 3 calls", async () => {
    const model = createFakeGenerationModel({ script: [INVALID, INVALID, INVALID, valid()] });
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("failed");
    expect(db.flow.error_code).toBe("GENERATION_EXHAUSTED");
    expect(db.job.status).toBe("failed");
    expect(db.job.state).toEqual({});
    expect(model.calls).toHaveLength(3);
    expect(db.usage).toHaveLength(3);
  });

  it("a 300,000-character response is unusable (F12), counts as a started call, and JSON.parse is never reached", async () => {
    const huge = `{"a":"${"x".repeat(300_000)}"}`;
    expect(huge.length).toBeGreaterThan(MAX_RESPONSE_CHARS);
    const model = createFakeGenerationModel({ script: [huge] });
    const { db, deps, logs } = setup(model);
    await runOnce(deps); // context
    expect(db.job.step).toBe("ai");
    const parse = vi.spyOn(JSON, "parse");
    await runOnce(deps); // ai
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(model.calls).toHaveLength(1);
    const state = generateStateSchema.parse(db.job.state);
    expect(state.modelCalls).toBe(1);
    expect(state.feedback).toEqual([{ rule: "F12" }]);
    expect(db.job.step).toBe("ai");
    expect(logs.find((line) => line.event === "ai.failed")?.fields.reason).toBe("invalid_output");
  });

  it("an empty response is unusable output (EMPTY, empty_content) and another call follows", async () => {
    const model = createFakeGenerationModel({ script: ["   "] });
    const { db, deps, clock, logs } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("ready");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("- EMPTY");
    expect(logs.find((line) => line.event === "ai.failed")?.fields.reason).toBe("empty_content");
  });
});

describe("generation job: provider failures and the 3-call cap", () => {
  it("retryable provider failure then success → ready with 2 calls", async () => {
    const model = createFakeGenerationModel({ script: [retryable()] });
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("ready");
    expect(model.calls).toHaveLength(2);
    expect(db.usage).toHaveLength(1);
  });

  it("404 from the provider → AI_UNAVAILABLE after 1 call", async () => {
    const model = createFakeGenerationModel({ script: [new ModelProviderError("http", 404, false)] });
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("failed");
    expect(db.flow.error_code).toBe("AI_UNAVAILABLE");
    expect(model.calls).toHaveLength(1);
  });

  it("two retryable provider failures in one visit → AI_UNAVAILABLE after 2 calls", async () => {
    const model = createFakeGenerationModel({ script: [retryable(), retryable()] });
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.error_code).toBe("AI_UNAVAILABLE");
    expect(model.calls).toHaveLength(2);
  });

  it("the cap reached after a provider failure ends AI_UNAVAILABLE (not GENERATION_EXHAUSTED)", async () => {
    const model = createFakeGenerationModel({ script: [INVALID, INVALID, retryable(), valid()] });
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("failed");
    expect(db.flow.error_code).toBe("AI_UNAVAILABLE");
    expect(model.calls).toHaveLength(3);
  });

  it.each([
    [[retryable(), INVALID, retryable(), retryable()]],
    [[INVALID, retryable(), INVALID, retryable()]],
    [[retryable(), INVALID, INVALID, INVALID]],
    [[INVALID, INVALID, INVALID, INVALID]],
    [[new Error("boom"), INVALID, INVALID, INVALID]],
  ])("never more than 3 started calls in any mix (%#)", async (script) => {
    const model = createFakeGenerationModel({ script: [...script] });
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock, 60);
    expect(db.job.status === "done" || db.job.status === "failed").toBe(true);
    expect(model.calls.length).toBeLessThanOrEqual(3);
  });

  it("the counter is written to the job row before the call starts", async () => {
    let seenCalls: number | null = null;
    const { db, deps } = setup(null);
    deps.model = {
      timeoutMs: 55_000,
      analyze: async () => {
        seenCalls = generateStateSchema.parse(db.job.state).modelCalls;
        throw new ModelProviderError("timeout", null, true);
      },
    };
    await runOnce(deps);
    await runOnce(deps);
    expect(seenCalls).toBe(1);
    expect(generateStateSchema.parse(db.job.state)).toMatchObject({ modelCalls: 1, lastProviderFailure: true });
  });

  it("model null (kill switch) → failed / AI_DISABLED with 0 calls and no GitHub read", async () => {
    const { db, deps, github, clock } = setup(null);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("failed");
    expect(db.flow.error_code).toBe("AI_DISABLED");
    expect(db.job.status).toBe("failed");
    expect(github.calls).toEqual([]);
    expect(db.usage).toEqual([]);
  });

  it("the edge runner with a complete OpenRouter env → AI_DISABLED and fetch is never called", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const model = createModelFromEnv(
      {
        ANALYSIS_PROVIDER: "openrouter",
        ANALYSIS_MODEL: "vendor/model",
        OPENROUTER_API_KEY: "sk-or-v1-not-a-real-key-0000000000",
        APP_URL: "http://localhost:3000",
        NODE_ENV: "development",
      },
      "edge",
      fetchSpy,
    );
    expect(model).toBeNull();
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.error_code).toBe("AI_DISABLED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ai.failed lines have exactly the five keys and carry no prompt or repo text", async () => {
    const model = createFakeGenerationModel({
      script: [INVALID, new ModelProviderError("http", 503, true), new ModelProviderError("http", 400, false)],
    });
    const { db, deps, clock, logs } = setup(model);
    await drain(deps, db, clock);
    const lines = logs.filter((line) => line.event === "ai.failed").map((line) => line.fields);
    expect(lines.length).toBe(3);
    for (const fields of lines) {
      expect(Object.keys(fields).sort()).toEqual(["attempt", "elapsedMs", "jobId", "reason", "status"]);
      const text = JSON.stringify(fields);
      expect(text).not.toContain(PROMPT_MARKER);
      expect(text).not.toContain("<repo_file");
    }
    for (const line of logs) expect(JSON.stringify(line)).not.toContain(PROMPT_MARKER);
  });
});

describe("generation job: context step", () => {
  it("a planted secret never reaches the job state or the prompt; the redacted text does", async () => {
    const model = createFakeGenerationModel();
    const { db, deps, clock } = setup(model);
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("ready");
    for (const write of db.stateWrites) expect(write).not.toContain(SECRET);
    const prompt = model.calls[0]?.prompt ?? "";
    expect(prompt).not.toContain(SECRET);
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).toContain('<repo_file path="src/app/api/orders/route.ts">');
  });

  it("a denied path (.env) in source_files is never fetched", async () => {
    const model = createFakeGenerationModel();
    const { db, deps, github } = setup(model, { sourceFiles: [".env", "src/lib/slack.ts"] });
    await runOnce(deps);
    expect(github.blobPathsFetched()).toEqual(["src/lib/slack.ts"]);
    const state = generateStateSchema.parse(db.job.state);
    expect(state.snippets.map((snippet) => snippet.path)).toEqual(["src/lib/slack.ts"]);
  });

  it("only the first 12 source files are read; a 13th is not fetched", async () => {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    for (let i = 1; i <= 13; i += 1) {
      const path = `src/f${String(i).padStart(2, "0")}.ts`;
      files[path] = `export const v${i} = ${i};\n`;
      paths.push(path);
    }
    const { db, deps, github } = setup(createFakeGenerationModel(), { sourceFiles: paths }, files);
    await runOnce(deps);
    expect(github.blobPathsFetched()).toEqual(paths.slice(0, 12));
    expect(generateStateSchema.parse(db.job.state).snippets).toHaveLength(12);
  });

  it("per-file cap 20,000 characters and total cap 60,000 (files in order until the cap)", async () => {
    const big = "x".repeat(30_000);
    const files = { "src/a.ts": big, "src/b.ts": big, "src/c.ts": big, "src/d.ts": "ok" };
    const { db, deps } = setup(createFakeGenerationModel(), { sourceFiles: Object.keys(files) }, files);
    await runOnce(deps);
    const state = generateStateSchema.parse(db.job.state);
    expect(state.snippets.map((snippet) => [snippet.path, snippet.text.length])).toEqual([
      ["src/a.ts", 20_000],
      ["src/b.ts", 20_000],
      ["src/c.ts", 20_000],
    ]);
  });

  it("repo id mismatch → GITHUB_ACCESS_LOST with no tree or blob read", async () => {
    const { db, deps, github, clock } = setup(createFakeGenerationModel());
    github.repoId = REPO_ID + 1;
    await drain(deps, db, clock);
    expect(db.flow.error_code).toBe("GITHUB_ACCESS_LOST");
    expect(github.calls.some((call) => call.op === "tree" || call.op === "blob")).toBe(false);
  });

  it("null installation → GITHUB_ACCESS_LOST", async () => {
    const { db, deps, clock } = setup(createFakeGenerationModel(), { installationRowId: null });
    await drain(deps, db, clock);
    expect(db.flow.error_code).toBe("GITHUB_ACCESS_LOST");
  });

  it("a missing tree (404 for the commit) continues with no snippets", async () => {
    const model = createFakeGenerationModel();
    const { db, deps, github, clock } = setup(model);
    github.treeStatus = 404;
    await drain(deps, db, clock);
    expect(db.flow.status).toBe("ready");
    expect(model.calls[0]?.prompt).not.toContain("<repo_file");
  });

  it("the tree is read at the analyzed commit, never the branch head", async () => {
    const sha = "d".repeat(40);
    const { deps, github } = setup(createFakeGenerationModel(), { commitSha: sha });
    await runOnce(deps);
    expect(github.calls.find((call) => call.op === "tree")?.args).toEqual(["acme/shop", sha]);
    expect(github.calls.some((call) => call.op === "branch")).toBe(false);
  });

  it("signals are filtered to the recommendation's source files", async () => {
    const signals = [
      { kind: "webhook", filePath: "src/app/api/orders/route.ts", line: 2, label: "POST /api/orders" },
      { kind: "route", filePath: "src/other.ts", line: 1, label: "GET /x" },
      { kind: "bogus" },
    ];
    const { db, deps } = setup(createFakeGenerationModel(), { signals });
    await runOnce(deps);
    expect(generateStateSchema.parse(db.job.state).signals.map((signal) => signal.filePath)).toEqual([
      "src/app/api/orders/route.ts",
    ]);
  });
});

describe("generation job: flow row guards", () => {
  it("a flow no longer generating (expired) ends the job without touching the flow", async () => {
    const { db, deps } = setup(createFakeGenerationModel());
    db.flow.status = "failed";
    db.flow.error_code = "JOB_EXPIRED";
    await runOnce(deps);
    expect(db.job.status).toBe("failed");
    expect(db.flow.error_code).toBe("JOB_EXPIRED");
    expect(db.flowUpdates).toEqual([]);
  });

  it("a missing flow row ends the job INTERNAL", async () => {
    const { db, deps } = setup(createFakeGenerationModel());
    db.flows.clear();
    await runOnce(deps);
    expect(db.job.status).toBe("failed");
    expect(db.job.last_error_code).toBe("INTERNAL");
  });

  it("a corrupt state ends the flow INTERNAL", async () => {
    const { db, deps } = setup(createFakeGenerationModel(), { step: "ai", state: { modelCalls: 9 } });
    await runOnce(deps);
    expect(db.flow.error_code).toBe("INTERNAL");
  });

  it("an analysis job still runs unchanged", async () => {
    const clock = new FakeClock();
    const db = new FakeWorkerDb(clock);
    db.seed();
    const github = new FakeGitHub({ "package.json": JSON.stringify({ dependencies: { next: "16" } }), "src/app/page.tsx": "export default 1;\n" });
    const deps: WorkerDeps = { db, github, model: createFakeModel(), now: clock.now, workerId: "w" };
    for (let i = 0; i < 30 && db.job.status !== "done"; i += 1) await runOnce(deps);
    expect(db.job.status).toBe("done");
    expect(db.analyses.get(ANALYSIS)?.status).toBe("done");
  });
});
