import { dedupeSignals, extractSignals } from "@/lib/analysis/extractors";
import { ModelProviderError, type AnalysisModel, type ModelFailureReason } from "@/lib/analysis/model/types";
import {
  ANALYSIS_MAX_OUTPUT_TOKENS,
  FILE_BUDGET_CHARS,
  ModelOutputInvalidError,
  buildAnalysisPrompt,
  capFileText,
  estimateRecommendationTokens,
  fileBlock,
  parseDrafts,
} from "@/lib/analysis/prompt";
import { blockedTotal, selectFiles } from "@/lib/analysis/select";
import { checkValidity, pickManifestPaths } from "@/lib/analysis/validity";
import { GitHubApiError } from "@/lib/github/errors";
import { StepError, accessLost, toStepError } from "@/lib/jobs/errors";
import type {
  AnalysisPatch,
  AnalysisRef,
  AnalyzeState,
  ProjectRef,
  RecommendationInsert,
  WorkerDeps,
} from "@/lib/jobs/types";
import {
  dedupeAndCapFindings,
  pathOnlyFinding,
  scan,
  type MaskedFinding,
} from "@/lib/security/secret-scanner";
import type { AnalysisStatus, BlockedByReason } from "@/schemas/analysis";
import type { JobErrorCode } from "@/schemas/api";

/**
 * Analysis job steps (contract section 4, Phase 2 item 9). Each step is
 * idempotent: it reads the job state, does one unit of work, and returns the
 * next step with the new state. Nothing is written to `jobs.state` until the
 * step succeeds, and only redacted text ever reaches it (the scanner runs in
 * the same step that fetched the file). Nothing here logs file text.
 */

export const FETCH_BATCH_SIZE = 25;
/** The `ai` step is tried at most twice (D-16). */
export const AI_MAX_ATTEMPTS = 2;

export type StepOutcome =
  | { kind: "next"; step: string; state: AnalyzeState }
  /** Ends the job: analysis `done` (optionally with AI_DISABLED). */
  | { kind: "done" }
  /** Ends the job without retry: analysis `rejected` or `failed`. */
  | { kind: "end"; analysisStatus: "rejected" | "failed"; errorCode: JobErrorCode };

export interface StepContext {
  deps: WorkerDeps;
  /** The job id, for the `ai.failed` log line (D-35). */
  jobId: string;
  analysis: AnalysisRef;
  project: ProjectRef;
  state: AnalyzeState;
  attempts: number;
  signal: AbortSignal;
  /**
   * Deadline of the model call inside the `ai` step (D-36 (d), R2c-2):
   * `max(budget - AI_STEP_MARGIN_MS, floor(budget / 2))`, so the adapter
   * always times out before the step timer. Set for every step; only
   * `stepAi` reads it.
   */
  aiCallTimeoutMs: number;
}

// --- helpers ------------------------------------------------------------------------

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Text of a blob, or null for binary (NUL byte) or invalid UTF-8. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return UTF8.decode(bytes);
  } catch {
    return null;
  }
}

export function fetchProgress(batchIndex: number, batches: number): number {
  if (batches <= 0) return 60;
  return 10 + Math.round((50 * (batchIndex + 1)) / batches);
}

/** R2-5: an abandoned (timed-out) step must not write anything more. */
export class StepAbortedError extends Error {
  constructor() {
    super("step aborted");
    this.name = "StepAbortedError";
  }
}

export function assertActive(ctx: StepContext): void {
  if (ctx.signal.aborted) throw new StepAbortedError();
}

/** Analysis patch that never moves progress backwards. */
async function progress(
  ctx: StepContext,
  status: AnalysisStatus,
  value: number,
  extra: AnalysisPatch = {},
): Promise<void> {
  assertActive(ctx);
  const next = Math.max(ctx.analysis.progress, value);
  await ctx.deps.db.updateAnalysis(ctx.analysis.id, { ...extra, status, progress: next });
  ctx.analysis.progress = next;
  ctx.analysis.status = status;
}

function blockedByReason(state: AnalyzeState): BlockedByReason {
  const counts = state.counts ?? { considered: 0, denied: 0, extension: 0, size: 0, cap: 0 };
  return {
    denied: counts.denied,
    // Fetched files dropped as binary / invalid UTF-8 count as `extension`.
    extension: counts.extension + state.unreadable,
    size: counts.size,
    cap: counts.cap,
  };
}

async function installationToken(ctx: StepContext): Promise<string> {
  const rowId = ctx.project.installation_id;
  if (rowId === null) throw accessLost();
  const githubId = await ctx.deps.db.getInstallationGithubId(rowId, ctx.project.user_id);
  if (githubId === null) throw accessLost();
  try {
    return await ctx.deps.github.mintToken(githubId);
  } catch (error) {
    throw toStepError(error);
  }
}

async function github<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toStepError(error);
  }
}

// --- steps --------------------------------------------------------------------------

/** `validate`: head of analyses.branch (never default_branch), tree, manifests, validity. */
export async function stepValidate(ctx: StepContext): Promise<StepOutcome> {
  const { deps, analysis, project } = ctx;
  await progress(ctx, "validating", 0);
  const token = await installationToken(ctx);

  // S2-1: the name must still resolve to the repo id the user was authorized
  // for (projects.repo_id) before any branch, tree, or blob read.
  const repoId = await github(() => deps.github.getRepoId(token, project.repo_full_name));
  if (project.repo_id === null || repoId === null || repoId !== project.repo_id) throw accessLost();

  let headSha: string;
  try {
    headSha = await deps.github.getBranchHeadSha(token, project.repo_full_name, analysis.branch);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      const readable = await github(() => deps.github.isRepoReadable(token, project.repo_full_name));
      throw readable ? new StepError("BRANCH_NOT_FOUND", false) : accessLost();
    }
    throw toStepError(error);
  }

  const tree = await github(() => deps.github.getTreeBlobs(token, project.repo_full_name, headSha));
  const manifestPaths = pickManifestPaths(tree.blobs);
  const shaByPath = new Map(tree.blobs.map((blob) => [blob.path, blob.sha]));
  // Manifest text is parsed in memory only: never stored, never logged.
  const manifests = new Map<string, string>();
  for (const path of manifestPaths) {
    const sha = shaByPath.get(path);
    if (sha === undefined) continue;
    const text = decodeText(await github(() => deps.github.getBlob(token, project.repo_full_name, sha)));
    if (text !== null) manifests.set(path, text);
  }
  const validation = checkValidity(
    tree.blobs.map((blob) => blob.path),
    manifests,
  );

  if (validation.kind === "invalid") {
    assertActive(ctx);
    await deps.db.updateProject(project.id, {
      status: "invalid",
      invalid_reason: validation.reason,
      stale: false,
    });
    await progress(ctx, "validating", 5, { validation, commit_sha: headSha });
    return { kind: "end", analysisStatus: "rejected", errorCode: "PROJECT_INVALID" };
  }

  assertActive(ctx);
  await deps.db.updateProject(project.id, {
    status: "valid",
    invalid_reason: null,
    detected_kind: validation.kind,
    last_commit_sha: headSha,
    stale: false,
  });
  await progress(ctx, "validating", 5, { validation, commit_sha: headSha });
  return {
    kind: "next",
    step: "select",
    state: { ...ctx.state, aiEnabled: deps.model !== null, commitSha: headSha },
  };
}

/** `select`: path policy over the tree, priority order, 400 cap, path-only findings. */
export async function stepSelect(ctx: StepContext): Promise<StepOutcome> {
  const { deps, project, state } = ctx;
  if (state.commitSha === undefined) throw new StepError("INTERNAL", false, "missing commit");
  const token = await installationToken(ctx);
  const commitSha = state.commitSha;
  const tree = await github(() => deps.github.getTreeBlobs(token, project.repo_full_name, commitSha));
  const selection = selectFiles(tree.blobs);
  const pathFindings = selection.deniedPaths
    .map((path) => pathOnlyFinding(path))
    .filter((finding): finding is MaskedFinding => finding !== null);

  const next: AnalyzeState = {
    ...state,
    selected: selection.selected,
    counts: selection.counts,
    pathFindings: dedupeAndCapFindings(pathFindings),
  };
  await progress(ctx, "scanning", 10, {
    files_considered: selection.counts.considered,
    files_blocked: blockedTotal(selection.counts),
    files_blocked_by_reason: blockedByReason(next),
  });
  return { kind: "next", step: selection.selected.length > 0 ? "fetch:0" : "scan", state: next };
}

/** `fetch:N`: fetch one batch of 25, scan + redact, extract, keep budgeted snippets. */
export async function stepFetch(ctx: StepContext, batchIndex: number): Promise<StepOutcome> {
  const { deps, project } = ctx;
  const selected = ctx.state.selected ?? [];
  const batches = Math.ceil(selected.length / FETCH_BATCH_SIZE);
  const batch = selected.slice(batchIndex * FETCH_BATCH_SIZE, (batchIndex + 1) * FETCH_BATCH_SIZE);
  const token = await installationToken(ctx);

  const state: AnalyzeState = {
    ...ctx.state,
    findings: [...ctx.state.findings],
    signals: [...ctx.state.signals],
    snippets: [...ctx.state.snippets],
    snippetChars: { ...ctx.state.snippetChars },
  };
  const newFindings: MaskedFinding[] = [];
  for (const file of batch) {
    const bytes = await github(() => deps.github.getBlob(token, project.repo_full_name, file.sha));
    const text = decodeText(bytes);
    if (text === null) {
      state.unreadable += 1;
      continue;
    }
    // The scanner runs before anything else touches the text.
    const result = scan(file.path, text);
    newFindings.push(...result.findings);
    state.signals.push(...extractSignals({ path: file.path, text: result.redacted }));
    state.filesRead += 1;

    if (!state.aiEnabled) continue;
    if (state.budgetClosed) {
      state.skippedBudget += 1;
      continue;
    }
    const cost = fileBlock(file.path, result.redacted).length;
    if (state.budgetUsedChars + cost > FILE_BUDGET_CHARS) {
      state.budgetClosed = true;
      state.skippedBudget += 1;
      continue;
    }
    const kept = capFileText(result.redacted).text;
    state.snippets.push({ path: file.path, text: kept });
    state.snippetChars[file.path] = kept.length;
    state.budgetUsedChars += cost;
  }
  state.findings = dedupeAndCapFindings([...state.findings, ...newFindings]);
  state.signals = dedupeSignals(state.signals);

  await progress(ctx, "scanning", fetchProgress(batchIndex, batches), { files_read: state.filesRead });
  const more = (batchIndex + 1) * FETCH_BATCH_SIZE < selected.length;
  return { kind: "next", step: more ? `fetch:${batchIndex + 1}` : "scan", state };
}

/** `scan`: merge path-only findings, dedupe, cap at 200. */
export async function stepScan(ctx: StepContext): Promise<StepOutcome> {
  const state: AnalyzeState = {
    ...ctx.state,
    findings: dedupeAndCapFindings([...ctx.state.pathFindings, ...ctx.state.findings]),
    pathFindings: [],
  };
  await progress(ctx, "scanning", 65);
  return { kind: "next", step: "detect", state };
}

/** `detect`: write findings (delete-then-insert) and signals; they survive a failed `ai`. */
export async function stepDetect(ctx: StepContext): Promise<StepOutcome> {
  const { deps, analysis, state } = ctx;
  assertActive(ctx);
  await deps.db.replaceFindings(analysis.id, analysis.user_id, state.findings);
  const reasons = blockedByReason(state);
  const runAi = state.aiEnabled && deps.model !== null;
  await progress(ctx, "analyzing", 70, {
    signals: dedupeSignals(state.signals),
    files_read: state.filesRead,
    files_considered: state.counts?.considered ?? 0,
    files_blocked: blockedTotal(reasons),
    files_blocked_by_reason: reasons,
    // R2-6: 0 whenever the ai step will not run.
    files_skipped_budget: runAi ? state.skippedBudget : 0,
  });
  return {
    kind: "next",
    step: runAi ? "ai" : "persist",
    state: { ...state, findings: [], aiSkipped: !runAi },
  };
}

/** `ai.failed` reasons (D-35 (b)): the adapter reasons plus the worker's own. */
export type AiFailureReason = ModelFailureReason | "empty_content" | "invalid_output" | "internal";

/** `ai`: one model call, usage_events row per response, drafts parsed with Zod. */
export async function stepAi(ctx: StepContext): Promise<StepOutcome> {
  const { deps, state } = ctx;
  if (deps.model === null || !state.aiEnabled) {
    return { kind: "next", step: "persist", state: { ...state, snippets: [], aiSkipped: true } };
  }
  // D-36 (d): the model call has its own deadline from the start of the step,
  // inside the step budget, so a slow model ends `timeout` / AI_UNAVAILABLE.
  // A plain setTimeout (not AbortSignal.timeout) so fake timers work.
  const call = new AbortController();
  const abortCall = () => call.abort();
  const deadline = setTimeout(abortCall, ctx.aiCallTimeoutMs);
  if (ctx.signal.aborted) call.abort();
  ctx.signal.addEventListener("abort", abortCall, { once: true });
  try {
    return await runAiCall(ctx, deps.model, call.signal);
  } finally {
    clearTimeout(deadline);
    ctx.signal.removeEventListener("abort", abortCall);
  }
}

async function runAiCall(ctx: StepContext, model: AnalysisModel, callSignal: AbortSignal): Promise<StepOutcome> {
  const { deps, analysis, state } = ctx;
  await progress(ctx, "analyzing", 75);
  const built = buildAnalysisPrompt(state.signals, state.snippets);
  const startedAt = Date.now();
  // D-35 (b): exactly one `ai.failed` line per failed model call or unusable
  // output, with these five keys only: never the provider, model id, message,
  // bodies, prompt, or key. D-36 (d): a step-budget abort (ctx.signal) or a
  // database error is INTERNAL and writes no line.
  const fail = (reason: AiFailureReason, status: number | null, error: StepError): Error => {
    if (ctx.signal.aborted) return new StepAbortedError();
    deps.log?.("ai.failed", {
      jobId: ctx.jobId,
      attempt: ctx.attempts,
      reason,
      status,
      elapsedMs: Date.now() - startedAt,
    });
    return error;
  };
  let output;
  try {
    output = await model.analyze({
      system: built.system,
      prompt: built.prompt,
      maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
      signal: callSignal,
    });
  } catch (error) {
    // At most 2 tries of `ai` so a flaky provider costs at most 2 billed calls.
    if (error instanceof ModelProviderError) {
      throw fail(
        error.reason,
        error.status,
        new StepError("AI_UNAVAILABLE", error.retryable && ctx.attempts < AI_MAX_ATTEMPTS, "model call failed"),
      );
    }
    throw fail("internal", null, new StepError("INTERNAL", ctx.attempts < AI_MAX_ATTEMPTS, "model call failed"));
  }
  const elapsedMs = Date.now() - startedAt;
  // R2c-5: every billed response is logged, so the usage row comes before the
  // abort check; assertActive still precedes every analysis or job state write.
  await deps.db.insertUsageEvent({
    userId: analysis.user_id,
    kind: "analysis",
    tokensIn: output.tokensIn,
    tokensOut: output.tokensOut,
    refId: analysis.id,
  });
  assertActive(ctx);
  const invalid = (reason: "empty_content" | "invalid_output"): Error => {
    if (ctx.signal.aborted) return new StepAbortedError();
    deps.log?.("ai.failed", { jobId: ctx.jobId, attempt: ctx.attempts, reason, status: null, elapsedMs });
    return new StepError("MODEL_OUTPUT_INVALID", false);
  };
  // D-35 (c): an empty or null response is not retried (the billed row is already written).
  if (output.text.trim() === "") throw invalid("empty_content");
  let drafts;
  try {
    drafts = parseDrafts(output.text, built.sentPaths);
  } catch (error) {
    if (error instanceof ModelOutputInvalidError) throw invalid("invalid_output");
    if (ctx.signal.aborted) throw new StepAbortedError();
    deps.log?.("ai.failed", { jobId: ctx.jobId, attempt: ctx.attempts, reason: "internal", status: null, elapsedMs });
    throw error;
  }
  deps.log?.("analysis.drafts", {
    analysisId: analysis.id,
    kept: drafts.drafts.length,
    dropped: drafts.dropped,
    droppedOverCap: drafts.droppedOverCap,
    droppedUnknownNodeTypes: drafts.droppedUnknownNodeTypes,
  });
  return {
    kind: "next",
    step: "persist",
    state: {
      ...state,
      // Repo text leaves the state as soon as the model has answered.
      snippets: [],
      skippedBudget: state.skippedBudget + built.skippedBudget,
      drafts: drafts.drafts,
    },
  };
}

/** `persist`: recommendations, then the analysis ends `done`. */
export async function stepPersist(ctx: StepContext): Promise<StepOutcome> {
  const { deps, analysis, state } = ctx;
  const rows: RecommendationInsert[] = (state.drafts ?? []).map((draft) => ({
    title: draft.title,
    description: draft.description,
    trigger_kind: draft.trigger_kind,
    confidence: draft.confidence,
    source_files: draft.source_files,
    required_credentials: draft.required_credentials,
    risk_level: draft.risk_level,
    node_types: draft.node_types,
    rationale: draft.rationale,
    estimated_tokens: estimateRecommendationTokens(draft.source_files, state.snippetChars),
  }));
  assertActive(ctx);
  await deps.db.replaceRecommendations(analysis.id, analysis.user_id, rows);
  await progress(ctx, "done", 100, {
    error_code: state.aiSkipped ? "AI_DISABLED" : null,
    files_skipped_budget: state.aiEnabled && !state.aiSkipped ? state.skippedBudget : 0,
    finished_at: deps.now().toISOString(),
  });
  return { kind: "done" };
}

export async function runAnalyzeStep(ctx: StepContext, step: string): Promise<StepOutcome> {
  if (step === "validate") return stepValidate(ctx);
  if (step === "select") return stepSelect(ctx);
  const fetchMatch = /^fetch:(\d{1,4})$/.exec(step);
  if (fetchMatch?.[1] !== undefined) return stepFetch(ctx, Number(fetchMatch[1]));
  if (step === "scan") return stepScan(ctx);
  if (step === "detect") return stepDetect(ctx);
  if (step === "ai") return stepAi(ctx);
  if (step === "persist") return stepPersist(ctx);
  throw new StepError("INTERNAL", false, "unknown step");
}
