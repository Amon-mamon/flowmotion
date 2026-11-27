import { capFileText } from "@/lib/analysis/prompt";
import { ModelProviderError, type AnalysisModel } from "@/lib/analysis/model/types";
import { CompileError, compileFlow } from "@/lib/compiler";
import { buildGenerationPrompt, GENERATION_MAX_OUTPUT_TOKENS } from "@/lib/generation/prompt";
import { dedupeFeedback, parseFlowSpecDraft } from "@/lib/generation/parse";
import { GitHubApiError } from "@/lib/github/errors";
import { AI_MAX_ATTEMPTS, StepAbortedError, decodeText, type AiFailureReason } from "@/lib/jobs/analyze";
import { StepError, accessLost, toStepError } from "@/lib/jobs/errors";
import {
  GENERATE_MAX_MODEL_CALLS,
  GENERATE_MAX_SIGNALS,
  GENERATE_MAX_SNIPPETS,
  GENERATE_SNIPPETS_TOTAL_CHARS,
  type AnalysisContextRef,
  type FeedbackEntry,
  type FlowRef,
  type GenerateState,
  type ProjectRef,
  type RecommendationRef,
  type WorkerDeps,
} from "@/lib/jobs/types";
import { CATALOG_VERSION, N8N_VERSION } from "@/lib/n8n-catalog/version";
import { classifyPath } from "@/lib/security/path-policy";
import { scan } from "@/lib/security/secret-scanner";
import { assertExportSafe, ExportNotSafeError, validateWorkflow } from "@/lib/validator";
import { signalSchema, type Signal } from "@/schemas/analysis";
import type { JobErrorCode } from "@/schemas/api";
import { jsonValueSchema } from "@/schemas/flow";
import { NODE_KEY_PATTERN } from "@/schemas/flowspec";

/**
 * Generation job steps (contract section 4, Phase 3b; D-40, D-59):
 * `context` → `ai` → `compile` → `validate` → `persist`. Each step is
 * idempotent: it reads the parsed `GenerateState`, does one unit of work, and
 * returns the next step with the new state. Repo text is scanned and redacted
 * in the `context` step before anything is written to `jobs.state`. At most 3
 * model calls are started per flow: the counter is written to the job row
 * before each call. Logs carry ids, step names, counts, rule ids and codes
 * only.
 */

export type GenerateOutcome =
  | { kind: "next"; step: string; state: GenerateState }
  /** `persist` finished: the flow is `ready`. */
  | { kind: "done" }
  /** Ends the job without retry; `touchFlow: false` leaves a flow that is no longer `generating` alone. */
  | { kind: "end"; errorCode: JobErrorCode; touchFlow?: boolean };

export interface GenerateStepContext {
  deps: WorkerDeps;
  jobId: string;
  attempts: number;
  flow: FlowRef;
  recommendation: RecommendationRef;
  analysis: AnalysisContextRef;
  project: ProjectRef;
  state: GenerateState;
  signal: AbortSignal;
  /** Deadline of the model call inside the `ai` step (D-36 (d)). */
  aiCallTimeoutMs: number;
}

/** First source files re-read per flow. */
export const GENERATE_SOURCE_FILES = GENERATE_MAX_SNIPPETS;

function assertActive(ctx: GenerateStepContext): void {
  if (ctx.signal.aborted) throw new StepAbortedError();
}

async function github<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toStepError(error);
  }
}

async function installationToken(ctx: GenerateStepContext): Promise<string> {
  const rowId = ctx.project.installation_id;
  if (rowId === null) throw accessLost();
  const githubId = await ctx.deps.db.getInstallationGithubId(rowId, ctx.project.user_id);
  if (githubId === null) throw accessLost();
  return github(() => ctx.deps.github.mintToken(githubId));
}

/** Signals of the analysis whose file is one of the recommendation's source files (≤ 100). */
export function filterSignals(raw: readonly unknown[], sourceFiles: readonly string[]): Signal[] {
  const wanted = new Set(sourceFiles);
  const out: Signal[] = [];
  for (const item of raw) {
    const parsed = signalSchema.safeParse(item);
    if (!parsed.success || !wanted.has(parsed.data.filePath)) continue;
    out.push(parsed.data);
    if (out.length >= GENERATE_MAX_SIGNALS) break;
  }
  return out;
}

// --- context ------------------------------------------------------------------------

/**
 * `context`: repo identity check (S2-1), tree at the analyzed commit, path
 * policy, blob fetch, scanner and redaction before any state write, caps,
 * filtered signals. A disabled AI ends the flow before any GitHub read.
 */
export async function stepContext(ctx: GenerateStepContext): Promise<GenerateOutcome> {
  const { deps, project, analysis, recommendation } = ctx;
  if (deps.model === null) return { kind: "end", errorCode: "AI_DISABLED" };

  const token = await installationToken(ctx);
  const repoId = await github(() => deps.github.getRepoId(token, project.repo_full_name));
  if (project.repo_id === null || repoId === null || repoId !== project.repo_id) throw accessLost();

  const snippets: { path: string; text: string }[] = [];
  const commitSha = analysis.commit_sha;
  if (commitSha !== null) {
    let blobs: { path: string; sha: string; size: number }[] = [];
    try {
      blobs = (await deps.github.getTreeBlobs(token, project.repo_full_name, commitSha)).blobs;
    } catch (error) {
      // A missing tree (the commit is gone) is not an error: continue without snippets.
      if (!(error instanceof GitHubApiError && (error.status === 404 || error.status === 422))) {
        throw toStepError(error);
      }
    }
    const byPath = new Map(blobs.map((blob) => [blob.path, blob]));
    let total = 0;
    for (const path of recommendation.source_files.slice(0, GENERATE_SOURCE_FILES)) {
      const entry = byPath.get(path);
      if (entry === undefined) continue;
      // Path policy first: denied, extension, and size are never fetched.
      if (!classifyPath(entry.path, entry.size).allowed) continue;
      let bytes: Uint8Array;
      try {
        bytes = await deps.github.getBlob(token, project.repo_full_name, entry.sha);
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) continue;
        throw toStepError(error);
      }
      const text = decodeText(bytes);
      if (text === null) continue;
      // The scanner runs before anything else touches the text; its findings are discarded.
      const kept = capFileText(scan(entry.path, text).redacted).text;
      if (total + kept.length > GENERATE_SNIPPETS_TOTAL_CHARS) break;
      snippets.push({ path: entry.path, text: kept });
      total += kept.length;
    }
  }

  assertActive(ctx);
  deps.log?.("generate.context", {
    jobId: ctx.jobId,
    flowId: ctx.flow.id,
    snippets: snippets.length,
  });
  return {
    kind: "next",
    step: "ai",
    state: {
      snippets,
      signals: filterSignals(analysis.signals, recommendation.source_files),
      modelCalls: 0,
      lastProviderFailure: false,
      feedback: [],
    },
  };
}

// --- ai -----------------------------------------------------------------------------

/** Back to `ai` with feedback; drafts and compile output are dropped. */
function backToAi(state: GenerateState, feedback: readonly FeedbackEntry[]): GenerateOutcome {
  const next: GenerateState = {
    snippets: state.snippets,
    signals: state.signals,
    modelCalls: state.modelCalls,
    lastProviderFailure: false,
    feedback: dedupeFeedback(feedback),
  };
  return { kind: "next", step: "ai", state: next };
}

/** `ai`: at most 3 started calls per flow; the counter is written before each call. */
export async function stepGenerateAi(ctx: GenerateStepContext): Promise<GenerateOutcome> {
  const { deps, state } = ctx;
  if (deps.model === null) return { kind: "end", errorCode: "AI_DISABLED" };
  if (state.modelCalls >= GENERATE_MAX_MODEL_CALLS) {
    return { kind: "end", errorCode: state.lastProviderFailure ? "AI_UNAVAILABLE" : "GENERATION_EXHAUSTED" };
  }
  // Count the call before it starts (one updateJob, lock held), so a timeout
  // or a crash still counts. Until a response arrives the call counts as a
  // provider failure.
  const counted: GenerateState = { ...state, modelCalls: state.modelCalls + 1, lastProviderFailure: true };
  assertActive(ctx);
  const held = await deps.db.updateJob(ctx.jobId, deps.workerId, { state: counted });
  if (!held) throw new StepAbortedError();

  const call = new AbortController();
  const abortCall = () => call.abort();
  const deadline = setTimeout(abortCall, ctx.aiCallTimeoutMs);
  if (ctx.signal.aborted) call.abort();
  ctx.signal.addEventListener("abort", abortCall, { once: true });
  try {
    return await runGenerationCall({ ...ctx, state: counted }, deps.model, call.signal);
  } finally {
    clearTimeout(deadline);
    ctx.signal.removeEventListener("abort", abortCall);
  }
}

async function runGenerationCall(
  ctx: GenerateStepContext,
  model: AnalysisModel,
  callSignal: AbortSignal,
): Promise<GenerateOutcome> {
  const { deps, state, recommendation } = ctx;
  const built = buildGenerationPrompt({
    recommendation,
    signals: state.signals,
    snippets: state.snippets,
    feedback: state.feedback,
  });
  const startedAt = Date.now();
  // D-35 (b): one `ai.failed` line per failed call or unusable output, five keys only.
  const logFailure = (reason: AiFailureReason, status: number | null) =>
    deps.log?.("ai.failed", {
      jobId: ctx.jobId,
      attempt: ctx.attempts,
      reason,
      status,
      elapsedMs: Date.now() - startedAt,
    });

  let output;
  try {
    output = await model.analyze({
      system: built.system,
      prompt: built.prompt,
      maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
      signal: callSignal,
    });
  } catch (error) {
    // D-36 (d): a step-budget abort is INTERNAL and writes no line.
    if (ctx.signal.aborted) throw new StepAbortedError();
    if (error instanceof ModelProviderError) {
      logFailure(error.reason, error.status);
      throw new StepError("AI_UNAVAILABLE", error.retryable && ctx.attempts < AI_MAX_ATTEMPTS, "model call failed");
    }
    logFailure("internal", null);
    throw new StepError("INTERNAL", ctx.attempts < AI_MAX_ATTEMPTS, "model call failed");
  }
  // R2c-5: every billed response is logged before any abort check.
  await deps.db.insertUsageEvent({
    userId: ctx.flow.user_id,
    kind: "generation",
    tokensIn: output.tokensIn,
    tokensOut: output.tokensOut,
    refId: ctx.flow.id,
  });
  assertActive(ctx);

  const parsed = parseFlowSpecDraft(output.text, recommendation.source_files);
  if (!parsed.ok) {
    logFailure(parsed.reason, null);
    deps.log?.("generate.feedback", {
      jobId: ctx.jobId,
      flowId: ctx.flow.id,
      modelCalls: state.modelCalls,
      rules: parsed.feedback.map((entry) => entry.rule).join(","),
    });
    return backToAi(state, parsed.feedback);
  }
  return {
    kind: "next",
    step: "compile",
    state: {
      snippets: state.snippets,
      signals: state.signals,
      modelCalls: state.modelCalls,
      lastProviderFailure: false,
      feedback: [],
      spec: parsed.spec,
    },
  };
}

// --- compile, validate, persist -----------------------------------------------------

/** `compile`: n8n JSON and setup checklist from `state.spec` (pure). */
export async function stepCompile(ctx: GenerateStepContext): Promise<GenerateOutcome> {
  const { state } = ctx;
  if (state.spec === undefined) return backToAi(state, []);
  let compiled;
  try {
    compiled = compileFlow(state.spec);
  } catch (error) {
    // A checked spec always compiles; anything else is our bug, not the model's.
    if (error instanceof CompileError) throw new StepError("INTERNAL", false, `compile ${error.reason}`);
    throw error;
  }
  assertActive(ctx);
  return {
    kind: "next",
    step: "validate",
    state: { ...state, n8nJson: jsonValueSchema.parse(compiled.workflow), checklist: compiled.checklist },
  };
}

/**
 * `validate`: `validateWorkflow(n8nJson, checklist)`, then `assertExportSafe`
 * (D-50). A failure becomes feedback and sends the job back to `ai` under the
 * same 3-call cap.
 */
export async function stepValidate(ctx: GenerateStepContext): Promise<GenerateOutcome> {
  const { deps, state } = ctx;
  if (state.spec === undefined || state.n8nJson === undefined || state.checklist === undefined) {
    return backToAi(state, []);
  }
  const keyByLabel = new Map(state.spec.nodes.map((node) => [node.label, node.key]));
  const feedback: FeedbackEntry[] = [];
  const result = validateWorkflow(state.n8nJson, state.checklist);
  if (!result.ok) {
    for (const error of result.errors) {
      const key = error.nodeName === undefined ? undefined : keyByLabel.get(error.nodeName);
      feedback.push(
        key !== undefined && NODE_KEY_PATTERN.test(key) ? { rule: `V${error.rule}`, nodeKey: key } : { rule: `V${error.rule}` },
      );
    }
  } else {
    try {
      assertExportSafe(state.n8nJson);
    } catch (error) {
      if (!(error instanceof ExportNotSafeError)) throw error;
      feedback.push({ rule: `EXPORT_${error.rule.toUpperCase() as Uppercase<typeof error.rule>}` });
    }
  }
  if (feedback.length === 0) {
    assertActive(ctx);
    return { kind: "next", step: "persist", state };
  }
  const entries = dedupeFeedback(feedback);
  deps.log?.("flow.validation_failed", {
    jobId: ctx.jobId,
    flowId: ctx.flow.id,
    rules: entries.map((entry) => entry.rule).join(","),
    nodeKeys: entries
      .map((entry) => entry.nodeKey)
      .filter((key): key is string => key !== undefined)
      .join(","),
  });
  return backToAi(state, entries);
}

/** `persist`: the flow becomes `ready` (only while still `generating`); state is cleared by the worker. */
export async function stepPersist(ctx: GenerateStepContext): Promise<GenerateOutcome> {
  const { deps, state } = ctx;
  if (state.spec === undefined || state.n8nJson === undefined || state.checklist === undefined) {
    return backToAi(state, []);
  }
  assertActive(ctx);
  const updated = await deps.db.updateGeneratingFlow(ctx.flow.id, {
    name: state.spec.name,
    flow_spec: state.spec,
    n8n_json: state.n8nJson,
    setup_checklist: state.checklist,
    catalog_version: CATALOG_VERSION,
    n8n_version: N8N_VERSION,
    status: "ready",
    error_code: null,
  });
  if (!updated) return { kind: "end", errorCode: "INTERNAL", touchFlow: false };
  return { kind: "done" };
}

export async function runGenerateStep(ctx: GenerateStepContext, step: string): Promise<GenerateOutcome> {
  if (step === "context") return stepContext(ctx);
  if (step === "ai") return stepGenerateAi(ctx);
  if (step === "compile") return stepCompile(ctx);
  if (step === "validate") return stepValidate(ctx);
  if (step === "persist") return stepPersist(ctx);
  throw new StepError("INTERNAL", false, "unknown step");
}
