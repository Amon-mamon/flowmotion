import { z } from "zod";

import type { AnalysisModel } from "@/lib/analysis/model/types";
import type { MaskedFinding } from "@/lib/security/secret-scanner";
import {
  findingCategorySchema,
  severitySchema,
  signalSchema,
  type AnalysisStatus,
  type BlockedByReason,
  type Signal,
  type ValidationResult,
} from "@/schemas/analysis";
import type { JobErrorCode } from "@/schemas/api";
import { recommendationDraftSchema } from "@/schemas/recommendation";

/**
 * Worker contracts (contract sections 4 and 5, Phase 2 item 9).
 * Runtime-neutral: shared by tests (in-memory fakes) and the Deno worker.
 */

// --- jobs row ----------------------------------------------------------------------

export const jobRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  kind: z.enum(["analyze", "generate"]),
  ref_id: z.uuid(),
  status: z.enum(["queued", "running", "done", "failed"]),
  step: z.string(),
  state: z.unknown(),
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  run_after: z.string(),
  locked_at: z.string().nullable(),
  locked_by: z.string().nullable(),
  last_error_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobRow = z.infer<typeof jobRowSchema>;

export interface JobPatch {
  status?: JobRow["status"];
  step?: string;
  state?: AnalyzeState | Record<string, never>;
  attempts?: number;
  run_after?: string;
  locked_at?: string | null;
  locked_by?: string | null;
  last_error_code?: string | null;
}

// --- analyze job state (worker-only, never contains raw file text) -----------------

export const maskedFindingSchema = z.object({
  category: findingCategorySchema,
  severity: severitySchema,
  filePath: z.string(),
  line: z.number().int().positive().nullable(),
  maskedEvidence: z.string().max(200),
  remediation: z.string(),
});

const selectedFileSchema = z.object({
  path: z.string(),
  sha: z.string(),
  size: z.number().int().nonnegative(),
});

export const analyzeStateSchema = z.object({
  aiEnabled: z.boolean().default(false),
  commitSha: z.string().optional(),
  selected: z.array(selectedFileSchema).optional(),
  counts: z
    .object({
      considered: z.number().int().nonnegative(),
      denied: z.number().int().nonnegative(),
      extension: z.number().int().nonnegative(),
      size: z.number().int().nonnegative(),
      cap: z.number().int().nonnegative(),
    })
    .optional(),
  pathFindings: z.array(maskedFindingSchema).default([]),
  findings: z.array(maskedFindingSchema).default([]),
  signals: z.array(signalSchema).default([]),
  /** Redacted, capped text of files that fit the prompt budget (AI enabled only). */
  snippets: z.array(z.object({ path: z.string(), text: z.string() })).default([]),
  /** Characters of each kept snippet (for estimated_tokens), kept after `ai`. */
  snippetChars: z.record(z.string(), z.number().int().nonnegative()).default({}),
  filesRead: z.number().int().nonnegative().default(0),
  /** Fetched files dropped as binary / invalid UTF-8 (counted as `extension`). */
  unreadable: z.number().int().nonnegative().default(0),
  skippedBudget: z.number().int().nonnegative().default(0),
  budgetUsedChars: z.number().int().nonnegative().default(0),
  budgetClosed: z.boolean().default(false),
  aiSkipped: z.boolean().default(false),
  drafts: z.array(recommendationDraftSchema).optional(),
});
export type AnalyzeState = z.infer<typeof analyzeStateSchema>;

// --- database rows the worker touches -----------------------------------------------

export interface AnalysisRef {
  id: string;
  project_id: string;
  user_id: string;
  status: AnalysisStatus;
  progress: number;
  /** Branch to analyze (copied from projects.branch at start). Never default_branch. */
  branch: string;
}

export interface ProjectRef {
  id: string;
  user_id: string;
  repo_full_name: string;
  /** GitHub repo id verified by analyze (D-22); the worker re-checks it at `validate` (S2-1). */
  repo_id: number | null;
  installation_id: string | null;
}

export interface AnalysisPatch {
  status?: AnalysisStatus;
  progress?: number;
  commit_sha?: string | null;
  validation?: ValidationResult;
  files_considered?: number;
  files_read?: number;
  files_blocked?: number;
  files_blocked_by_reason?: BlockedByReason;
  files_skipped_budget?: number;
  signals?: Signal[];
  error_code?: JobErrorCode | null;
  finished_at?: string | null;
}

export interface ProjectPatch {
  status?: "pending" | "valid" | "invalid";
  invalid_reason?: string | null;
  detected_kind?: "website" | "app" | null;
  last_commit_sha?: string | null;
  stale?: boolean;
}

export interface RecommendationInsert {
  title: string;
  description: string;
  trigger_kind: "webhook" | "schedule" | "manual";
  confidence: number;
  source_files: string[];
  required_credentials: string[];
  risk_level: "low" | "medium" | "high";
  node_types: string[];
  rationale: string;
  estimated_tokens: number;
}

export interface UsageEventInsert {
  userId: string;
  kind: "analysis" | "generation";
  tokensIn: number;
  tokensOut: number;
  refId: string;
}

/** Persistence used by the worker (service role). */
export interface WorkerDb {
  /**
   * `claim_job(p_worker_id, p_user_id)`: 0 or 1 job, already marked running.
   * `userId` limits the claim to that user's jobs (local runner only, D-27).
   */
  claimJob(workerId: string, userId?: string): Promise<JobRow | null>;
  /** Updates the job only while this worker still holds its lock. */
  updateJob(jobId: string, workerId: string, patch: JobPatch): Promise<boolean>;
  getAnalysis(id: string): Promise<AnalysisRef | null>;
  updateAnalysis(id: string, patch: AnalysisPatch): Promise<void>;
  getProject(id: string): Promise<ProjectRef | null>;
  updateProject(id: string, patch: ProjectPatch): Promise<void>;
  /** GitHub's numeric installation id for a github_installations row of this user. */
  getInstallationGithubId(installationRowId: string, userId: string): Promise<number | null>;
  /** Delete-then-insert (idempotent). */
  replaceFindings(analysisId: string, userId: string, findings: readonly MaskedFinding[]): Promise<void>;
  /** Delete-then-insert (idempotent). */
  replaceRecommendations(
    analysisId: string,
    userId: string,
    rows: readonly RecommendationInsert[],
  ): Promise<void>;
  insertUsageEvent(event: UsageEventInsert): Promise<void>;
}

export interface TreeBlobEntry {
  path: string;
  sha: string;
  size: number;
}

/** GitHub access used by the worker (installation token minted per invocation). */
export interface WorkerGitHub {
  mintToken(installationId: number): Promise<string>;
  /** Head sha of the analysis branch; GitHubApiError 404 when the branch is gone. */
  getBranchHeadSha(token: string, fullName: string, branch: string): Promise<string>;
  /** GitHub's repo id for `fullName` (`GET /repos/{o}/{r}`), or null when not readable (404). */
  getRepoId(token: string, fullName: string): Promise<number | null>;
  /**
   * After a branch-head 404 at `validate`: true when the repo itself is still
   * readable (→ BRANCH_NOT_FOUND), false otherwise (→ GITHUB_ACCESS_LOST).
   */
  isRepoReadable(token: string, fullName: string): Promise<boolean>;
  getTreeBlobs(token: string, fullName: string, sha: string): Promise<{ blobs: TreeBlobEntry[]; truncated: boolean }>;
  getBlob(token: string, fullName: string, sha: string): Promise<Uint8Array>;
}

export type WorkerLog = (event: string, fields: Record<string, string | number | boolean | null>) => void;

export interface WorkerDeps {
  db: WorkerDb;
  github: WorkerGitHub;
  /** null when the AI kill switch is on (resolveModelConfig → disabled). */
  model: AnalysisModel | null;
  now: () => Date;
  workerId: string;
  /** Local runner only (D-27): claim only this user's jobs. */
  claimUserId?: string;
  /** Ids, step names, counts and codes only. */
  log?: WorkerLog;
  /** Overrides for tests. */
  stepTimeoutMs?: number;
  aiStepTimeoutMs?: number;
}
