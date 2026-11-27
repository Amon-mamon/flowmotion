import { ANTHROPIC_TIMEOUT_MS } from "@/lib/analysis/model/anthropic";
import { AI_MAX_ATTEMPTS, runAnalyzeStep, type StepContext, type StepOutcome } from "@/lib/jobs/analyze";
import { StepError } from "@/lib/jobs/errors";
import { runGenerateStep, type GenerateOutcome, type GenerateStepContext } from "@/lib/jobs/generate";
import { analyzeStateSchema, generateStateSchema, type JobRow, type WorkerDeps } from "@/lib/jobs/types";
import type { JobErrorCode } from "@/schemas/api";

/**
 * Chunked job worker (contract sections 4 and 5, D-10). `runOnce` claims at
 * most one job through `claim_job()`, runs exactly one step under its time
 * budget, then advances, retries with backoff, or ends the job. The job
 * state is cleared on `done` and `failed`, so no repository text outlives
 * the job. Logs carry ids, step names, counts and codes only.
 */

export const STEP_TIMEOUT_MS = 20_000;
/** D-35 (a): the `ai` step budget is the model adapter's timeout plus this margin... */
export const AI_STEP_MARGIN_MS = 5_000;
/** ...capped here, at least 10 s inside the stale-lock window, so a running billed call is never re-claimed. */
export const AI_STEP_MAX_MS = 110_000;
/**
 * Mirror of the stale-lock re-claim window in `claim_job()`: SQL
 * `interval '2 minutes'` in supabase/migrations/20261114000000_phase2_analysis.sql
 * and 20261114120000_phase2_review_fixes.sql. The SQL does not read this; it
 * exists so tests pin the budget invariant against it.
 */
export const STALE_LOCK_MS = 120_000;

/** The `ai` step budget: `min(model.timeoutMs + 5 s, 110 s)`. Never branches on the provider. */
export function aiStepBudgetMs(deps: Pick<WorkerDeps, "aiStepTimeoutMs" | "model">): number {
  return (
    deps.aiStepTimeoutMs ??
    Math.min((deps.model?.timeoutMs ?? ANTHROPIC_TIMEOUT_MS) + AI_STEP_MARGIN_MS, AI_STEP_MAX_MS)
  );
}
/**
 * D-36 (d): the model call deadline inside the `ai` step,
 * `max(budget - AI_STEP_MARGIN_MS, floor(budget / 2))`, so the adapter
 * always times out before the step timer.
 */
export function aiCallTimeoutMs(budgetMs: number): number {
  return Math.max(budgetMs - AI_STEP_MARGIN_MS, Math.floor(budgetMs / 2));
}
export const BACKOFF_BASE_MS = 30_000;
export const DUE_NOW_SKEW_MS = 5_000;

export type RunOutcome = "idle" | "advanced" | "done" | "failed" | "retry" | "lock_lost";

export interface RunResult {
  outcome: RunOutcome;
  jobId: string | null;
  step: string | null;
  /** True when another call should follow at once (a job was claimed). */
  more: boolean;
}

/** `run_after` delay after the n-th failed try of a step: 30s, 60s, 120s, 240s. */
export function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

class StepTimeoutError extends Error {
  constructor() {
    super("step timed out");
    this.name = "StepTimeoutError";
  }
}

async function withTimeout<T>(ms: number, controller: AbortController, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new StepTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function result(outcome: RunOutcome, job: JobRow | null): RunResult {
  return { outcome, jobId: job?.id ?? null, step: job?.step ?? null, more: job !== null };
}

/** Ends the job (state cleared) and marks the analysis. Analysis first, so a lost job write re-runs safely. */
async function endJob(
  deps: WorkerDeps,
  job: JobRow,
  analysisId: string | null,
  analysisStatus: "rejected" | "failed",
  code: JobErrorCode,
): Promise<RunResult> {
  if (analysisId !== null) {
    await deps.db.updateAnalysis(analysisId, {
      status: analysisStatus,
      error_code: code,
      finished_at: deps.now().toISOString(),
    });
  }
  const held = await deps.db.updateJob(job.id, deps.workerId, {
    status: "failed",
    state: {},
    last_error_code: code,
    locked_at: null,
    locked_by: null,
  });
  deps.log?.("job.failed", { jobId: job.id, step: job.step, code });
  return result(held ? "failed" : "lock_lost", job);
}

export async function runOnce(deps: WorkerDeps): Promise<RunResult> {
  const job =
    deps.claimUserId === undefined
      ? await deps.db.claimJob(deps.workerId)
      : await deps.db.claimJob(deps.workerId, deps.claimUserId);
  if (job === null) return result("idle", null);
  const log = deps.log;
  log?.("job.claimed", { jobId: job.id, step: job.step, attempts: job.attempts });

  if (job.kind === "generate") return runGenerate(deps, job);

  const analysis = await deps.db.getAnalysis(job.ref_id);
  if (analysis === null) return endJob(deps, job, null, "failed", "INTERNAL");
  // A crash loop (stale lock re-queued past the limit) ends the job.
  if (job.attempts > job.max_attempts) return endJob(deps, job, analysis.id, "failed", "INTERNAL");

  // R2-1: hard `ai` limit. A crash after a billed call re-queues the job
  // through the stale-lock path; never start a third try.
  if (job.step === "ai" && job.attempts > AI_MAX_ATTEMPTS) {
    return endJob(deps, job, analysis.id, "failed", "INTERNAL");
  }

  const project = await deps.db.getProject(analysis.project_id);
  if (project === null) return endJob(deps, job, analysis.id, "failed", "INTERNAL");

  const parsedState = analyzeStateSchema.safeParse(job.state ?? {});
  if (!parsedState.success) return endJob(deps, job, analysis.id, "failed", "INTERNAL");

  const controller = new AbortController();
  const aiBudget = aiStepBudgetMs(deps);
  const ctx: StepContext = {
    deps,
    jobId: job.id,
    analysis,
    project,
    state: parsedState.data,
    attempts: job.attempts,
    signal: controller.signal,
    aiCallTimeoutMs: aiCallTimeoutMs(aiBudget),
  };
  const budget = job.step === "ai" ? aiBudget : (deps.stepTimeoutMs ?? STEP_TIMEOUT_MS);

  let outcome: StepOutcome;
  try {
    outcome = await withTimeout(budget, controller, () => runAnalyzeStep(ctx, job.step));
  } catch (error) {
    const stepError =
      error instanceof StepError
        ? error
        : new StepError("INTERNAL", true, error instanceof Error ? error.name : "unknown");
    const aiExhausted = job.step === "ai" && job.attempts >= AI_MAX_ATTEMPTS;
    if (!stepError.retryable || aiExhausted || job.attempts >= job.max_attempts) {
      const status = stepError.code === "PROJECT_INVALID" ? "rejected" : "failed";
      return endJob(deps, job, analysis.id, status, stepError.code);
    }
    const held = await deps.db.updateJob(job.id, deps.workerId, {
      status: "queued",
      last_error_code: stepError.code,
      run_after: new Date(deps.now().getTime() + backoffMs(job.attempts)).toISOString(),
      locked_at: null,
      locked_by: null,
    });
    log?.("job.retry", { jobId: job.id, step: job.step, attempts: job.attempts, code: stepError.code });
    return result(held ? "retry" : "lock_lost", job);
  }

  if (outcome.kind === "end") {
    return endJob(deps, job, analysis.id, outcome.analysisStatus, outcome.errorCode);
  }

  if (outcome.kind === "done") {
    const held = await deps.db.updateJob(job.id, deps.workerId, {
      status: "done",
      state: {},
      last_error_code: null,
      locked_at: null,
      locked_by: null,
    });
    log?.("job.done", { jobId: job.id });
    return result(held ? "done" : "lock_lost", job);
  }

  const held = await deps.db.updateJob(job.id, deps.workerId, {
    status: "queued",
    step: outcome.step,
    state: outcome.state,
    attempts: 0,
    // "Due now", with a small margin for clock skew against the database.
    run_after: new Date(deps.now().getTime() - DUE_NOW_SKEW_MS).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error_code: null,
  });
  log?.("job.advanced", { jobId: job.id, from: job.step, to: outcome.step });
  return result(held ? "advanced" : "lock_lost", job);
}

// --- generation jobs (Phase 3b, contract section 4, D-40) -------------------------

/**
 * Ends a generation job (state cleared). The flow is marked `failed` first,
 * and only while it is still `generating`, so a lost job write re-runs safely
 * and an expired flow is never touched.
 */
async function endGenerateJob(
  deps: WorkerDeps,
  job: JobRow,
  code: JobErrorCode,
  touchFlow: boolean,
): Promise<RunResult> {
  if (touchFlow) await deps.db.updateGeneratingFlow(job.ref_id, { status: "failed", error_code: code });
  const held = await deps.db.updateJob(job.id, deps.workerId, {
    status: "failed",
    state: {},
    last_error_code: code,
    locked_at: null,
    locked_by: null,
  });
  deps.log?.("job.failed", { jobId: job.id, step: job.step, code });
  return result(held ? "failed" : "lock_lost", job);
}

async function runGenerate(deps: WorkerDeps, job: JobRow): Promise<RunResult> {
  const log = deps.log;
  const flow = await deps.db.getFlow(job.ref_id);
  if (flow === null) return endGenerateJob(deps, job, "INTERNAL", false);
  // A flow that is no longer generating (for example expired) is left alone.
  if (flow.status !== "generating") return endGenerateJob(deps, job, "INTERNAL", false);
  if (job.attempts > job.max_attempts) return endGenerateJob(deps, job, "INTERNAL", true);
  // R2-1: never start a third try of `ai` after a crash.
  if (job.step === "ai" && job.attempts > AI_MAX_ATTEMPTS) return endGenerateJob(deps, job, "INTERNAL", true);

  const recommendation = await deps.db.getRecommendation(flow.recommendation_id);
  if (recommendation === null) return endGenerateJob(deps, job, "INTERNAL", true);
  const analysis = await deps.db.getAnalysisContext(recommendation.analysis_id);
  if (analysis === null) return endGenerateJob(deps, job, "INTERNAL", true);
  const project = await deps.db.getProject(analysis.project_id);
  if (project === null) return endGenerateJob(deps, job, "INTERNAL", true);
  if (
    recommendation.user_id !== flow.user_id ||
    analysis.user_id !== flow.user_id ||
    project.user_id !== flow.user_id ||
    job.user_id !== flow.user_id
  ) {
    return endGenerateJob(deps, job, "INTERNAL", true);
  }

  const parsedState = generateStateSchema.safeParse(job.state ?? {});
  if (!parsedState.success) return endGenerateJob(deps, job, "INTERNAL", true);

  const controller = new AbortController();
  const aiBudget = aiStepBudgetMs(deps);
  const ctx: GenerateStepContext = {
    deps,
    jobId: job.id,
    attempts: job.attempts,
    flow,
    recommendation,
    analysis,
    project,
    state: parsedState.data,
    signal: controller.signal,
    aiCallTimeoutMs: aiCallTimeoutMs(aiBudget),
  };
  const budget = job.step === "ai" ? aiBudget : (deps.stepTimeoutMs ?? STEP_TIMEOUT_MS);

  let outcome: GenerateOutcome;
  try {
    outcome = await withTimeout(budget, controller, () => runGenerateStep(ctx, job.step));
  } catch (error) {
    const stepError =
      error instanceof StepError
        ? error
        : new StepError("INTERNAL", true, error instanceof Error ? error.name : "unknown");
    const aiExhausted = job.step === "ai" && job.attempts >= AI_MAX_ATTEMPTS;
    if (!stepError.retryable || aiExhausted || job.attempts >= job.max_attempts) {
      return endGenerateJob(deps, job, stepError.code, true);
    }
    const held = await deps.db.updateJob(job.id, deps.workerId, {
      status: "queued",
      last_error_code: stepError.code,
      run_after: new Date(deps.now().getTime() + backoffMs(job.attempts)).toISOString(),
      locked_at: null,
      locked_by: null,
    });
    log?.("job.retry", { jobId: job.id, step: job.step, attempts: job.attempts, code: stepError.code });
    return result(held ? "retry" : "lock_lost", job);
  }

  if (outcome.kind === "end") return endGenerateJob(deps, job, outcome.errorCode, outcome.touchFlow ?? true);

  if (outcome.kind === "done") {
    const held = await deps.db.updateJob(job.id, deps.workerId, {
      status: "done",
      state: {},
      last_error_code: null,
      locked_at: null,
      locked_by: null,
    });
    log?.("job.done", { jobId: job.id });
    return result(held ? "done" : "lock_lost", job);
  }

  const held = await deps.db.updateJob(job.id, deps.workerId, {
    status: "queued",
    step: outcome.step,
    state: outcome.state,
    attempts: 0,
    run_after: new Date(deps.now().getTime() - DUE_NOW_SKEW_MS).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error_code: null,
  });
  log?.("job.advanced", { jobId: job.id, from: job.step, to: outcome.step });
  return result(held ? "advanced" : "lock_lost", job);
}
