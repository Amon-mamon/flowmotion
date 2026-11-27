import { z } from "zod";

import {
  MAX_SIGNALS,
  analysisStatusSchema,
  findingCategorySchema,
  severitySchema,
  signalSchema,
  validationResultSchema,
  type Analysis,
  type Finding,
  type Signal,
} from "@/schemas/analysis";
import { jobErrorCodeSchema } from "@/schemas/api";
import type { Installation } from "@/schemas/github";
import type { Profile } from "@/schemas/profile";
import {
  recommendationStatusSchema,
  riskLevelSchema,
  triggerKindSchema,
  type Recommendation,
} from "@/schemas/recommendation";
import type { Project, ProjectAnalysisSummary } from "@/schemas/project";

/**
 * Database row schemas (snake_case) and mappers to the camelCase DTOs in
 * docs/contract.md section 6. Rows are validated when they leave Supabase so
 * the API never emits an unexpected shape.
 */

const timestamp = z.string();

export const installationRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  installation_id: z.number().int(),
  account_login: z.string(),
  created_at: timestamp,
  github_user_id: z.number().int().nullable(),
  github_user_login: z.string().nullable(),
  repos_synced_at: timestamp.nullable(),
});
export type InstallationRow = z.infer<typeof installationRowSchema>;

export const projectRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  installation_id: z.uuid().nullable(),
  repo_full_name: z.string(),
  repo_id: z.number().int().nullable(),
  default_branch: z.string(),
  branch: z.string(),
  status: z.enum(["pending", "valid", "invalid"]),
  invalid_reason: z.string().nullable(),
  detected_kind: z.enum(["website", "app"]).nullable(),
  last_commit_sha: z.string().nullable(),
  stale: z.boolean(),
  created_at: timestamp,
});
export type ProjectRow = z.infer<typeof projectRowSchema>;

export const analysisSummaryRowSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "validating", "scanning", "analyzing", "done", "failed", "rejected"]),
  commit_sha: z.string().nullable(),
  // Unknown or legacy codes are shown as null rather than failing the page.
  error_code: z.string().nullable().transform((value) => {
    const parsed = jobErrorCodeSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }),
  started_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
});

export const profileRowSchema = z.object({
  id: z.uuid(),
  display_name: z.string().nullable(),
});

export const PROJECT_COLUMNS =
  "id, user_id, installation_id, repo_full_name, repo_id, default_branch, branch, status, invalid_reason, detected_kind, last_commit_sha, stale, created_at";
export const INSTALLATION_COLUMNS =
  "id, user_id, installation_id, account_login, created_at, github_user_id, github_user_login, repos_synced_at";

/** Repo access sets are fresh for 24 hours (D-22, OQ-20). */
export const REPO_ACCESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** True when the row's repo set is missing or older than 24 h. */
export function needsRepoRefresh(reposSyncedAt: string | null, nowMs: number = Date.now()): boolean {
  if (reposSyncedAt === null) return true;
  const synced = new Date(reposSyncedAt).getTime();
  if (Number.isNaN(synced)) return true;
  return nowMs - synced > REPO_ACCESS_MAX_AGE_MS;
}
export const ANALYSIS_SUMMARY_COLUMNS = "id, status, commit_sha, error_code, started_at, finished_at";

/** Postgres returns `+00:00`-style offsets; normalise to ISO 8601 `Z`. */
export function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function toInstallationDto(row: InstallationRow): Installation {
  return {
    id: row.id,
    installationId: row.installation_id,
    accountLogin: row.account_login,
    createdAt: toIso(row.created_at),
    githubUserLogin: row.github_user_login,
    reposSyncedAt: row.repos_synced_at === null ? null : toIso(row.repos_synced_at),
    needsRefresh: needsRepoRefresh(row.repos_synced_at),
  };
}

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    repoFullName: row.repo_full_name,
    defaultBranch: row.default_branch,
    branch: row.branch,
    status: row.status,
    invalidReason: row.invalid_reason,
    detectedKind: row.detected_kind,
    lastCommitSha: row.last_commit_sha,
    stale: row.stale,
    installationId: row.installation_id,
    createdAt: toIso(row.created_at),
  };
}

/** True when the analysis shows a recommendation count (D-36 (b)). */
export function analysisHasRecommendationCount(row: z.infer<typeof analysisSummaryRowSchema>): boolean {
  return row.status === "done" && row.error_code === null;
}

export function toAnalysisSummaryDto(
  row: z.infer<typeof analysisSummaryRowSchema>,
  counts: ReadonlyMap<string, number>,
): ProjectAnalysisSummary {
  return {
    id: row.id,
    status: row.status,
    commitSha: row.commit_sha,
    errorCode: row.error_code,
    startedAt: row.started_at === null ? null : toIso(row.started_at),
    finishedAt: row.finished_at === null ? null : toIso(row.finished_at),
    recommendationCount: analysisHasRecommendationCount(row) ? (counts.get(row.id) ?? 0) : null,
  };
}

export function toProfileDto(row: z.infer<typeof profileRowSchema>, email: string): Profile {
  return { id: row.id, email, displayName: row.display_name };
}

// --- Phase 2: analyses, findings, recommendations -----------------------------------

export const ANALYSIS_COLUMNS =
  "id, project_id, status, progress, branch, commit_sha, validation, files_considered, files_read, files_blocked, files_blocked_by_reason, files_skipped_budget, signals, error_code, started_at, finished_at";

const countSchema = z.number().int().nonnegative().catch(0);

export const analysisRowSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  status: analysisStatusSchema,
  progress: z.number().int().min(0).max(100),
  branch: z.string(),
  commit_sha: z.string().nullable(),
  validation: validationResultSchema.nullable().catch(null),
  files_considered: countSchema,
  files_read: countSchema,
  files_blocked: countSchema,
  // Readers treat a missing key (rows written before `cap`) as 0.
  files_blocked_by_reason: z
    .object({ denied: countSchema, extension: countSchema, size: countSchema, cap: countSchema })
    .catch({ denied: 0, extension: 0, size: 0, cap: 0 }),
  files_skipped_budget: countSchema,
  signals: z.array(z.unknown()).catch([]),
  error_code: z.string().nullable(),
  started_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
});
export type AnalysisRow = z.infer<typeof analysisRowSchema>;

export function toAnalysisDto(row: AnalysisRow): Analysis {
  const signals: Signal[] = [];
  for (const item of row.signals) {
    const parsed = signalSchema.safeParse(item);
    if (parsed.success && signals.length < MAX_SIGNALS) signals.push(parsed.data);
  }
  const errorCode = jobErrorCodeSchema.safeParse(row.error_code);
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress,
    branch: row.branch,
    commitSha: row.commit_sha,
    validation: row.validation,
    counts: {
      filesConsidered: row.files_considered,
      filesRead: row.files_read,
      filesBlocked: row.files_blocked,
      filesBlockedByReason: row.files_blocked_by_reason,
      filesSkippedBudget: row.files_skipped_budget,
    },
    signals,
    errorCode: errorCode.success ? errorCode.data : null,
    startedAt: row.started_at === null ? null : toIso(row.started_at),
    finishedAt: row.finished_at === null ? null : toIso(row.finished_at),
  };
}

export const FINDING_COLUMNS = "id, analysis_id, category, severity, file_path, line, masked_evidence, remediation";

export const findingRowSchema = z.object({
  id: z.uuid(),
  analysis_id: z.uuid(),
  category: findingCategorySchema,
  severity: severitySchema,
  file_path: z.string(),
  line: z.number().int().positive().nullable(),
  masked_evidence: z.string(),
  remediation: z.string(),
});
export type FindingRow = z.infer<typeof findingRowSchema>;

export function toFindingDto(row: FindingRow): Finding {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    category: row.category,
    severity: row.severity,
    filePath: row.file_path,
    line: row.line,
    maskedEvidence: row.masked_evidence,
    remediation: row.remediation,
  };
}

export const RECOMMENDATION_COLUMNS =
  "id, analysis_id, title, description, trigger_kind, confidence, source_files, required_credentials, risk_level, node_types, rationale, estimated_tokens, status";

export const recommendationRowSchema = z.object({
  id: z.uuid(),
  analysis_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  trigger_kind: triggerKindSchema,
  confidence: z.number().min(0).max(1),
  source_files: z.array(z.string()),
  required_credentials: z.array(z.string()),
  risk_level: riskLevelSchema,
  node_types: z.array(z.string()),
  rationale: z.string(),
  estimated_tokens: z.number().int().nonnegative(),
  status: recommendationStatusSchema,
});
export type RecommendationRow = z.infer<typeof recommendationRowSchema>;

/** The newest flow of a recommendation (by created_at), for the derived status (D-41). */
export interface NewestFlow {
  id: string;
  status: "generating" | "ready" | "failed";
}

/**
 * Recommendation.status and flowId are derived from the newest flow (D-41):
 * none → new / null; generating → selected; ready → generated; failed → new
 * with that flow's id. The `recommendations.status` column is not read.
 */
export function deriveRecommendationStatus(newest: NewestFlow | undefined): Pick<Recommendation, "status" | "flowId"> {
  if (newest === undefined) return { status: "new", flowId: null };
  if (newest.status === "generating") return { status: "selected", flowId: newest.id };
  if (newest.status === "ready") return { status: "generated", flowId: newest.id };
  return { status: "new", flowId: newest.id };
}

export function toRecommendationDto(row: RecommendationRow, newest?: NewestFlow): Recommendation {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    title: row.title,
    description: row.description,
    triggerKind: row.trigger_kind,
    confidence: row.confidence,
    sourceFiles: row.source_files,
    requiredCredentials: row.required_credentials,
    riskLevel: row.risk_level,
    nodeTypes: row.node_types,
    rationale: row.rationale,
    estimatedTokens: row.estimated_tokens,
    ...deriveRecommendationStatus(newest),
  };
}
