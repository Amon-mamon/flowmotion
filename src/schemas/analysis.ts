import { z } from "zod";

import { isoDateTimeSchema, jobErrorCodeSchema, uuidSchema } from "@/schemas/api";

/**
 * Analysis DTOs (docs/contract.md section 6, Phase 2). Runtime-neutral:
 * shared by route handlers, the worker and the frontend.
 */

export const ANALYSIS_STATUSES = [
  "queued",
  "validating",
  "scanning",
  "analyzing",
  "done",
  "failed",
  "rejected",
] as const;
export const analysisStatusSchema = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

/** Statuses of an analysis that is still running (at most one per project). */
export const ACTIVE_ANALYSIS_STATUSES = ["queued", "validating", "scanning", "analyzing"] as const;

export function isActiveAnalysisStatus(status: AnalysisStatus): boolean {
  return (ACTIVE_ANALYSIS_STATUSES as readonly string[]).includes(status);
}

export const blockedByReasonSchema = z.object({
  denied: z.number().int().nonnegative(),
  extension: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  cap: z.number().int().nonnegative(),
});
export type BlockedByReason = z.infer<typeof blockedByReasonSchema>;

export const analysisCountsSchema = z.object({
  filesConsidered: z.number().int().nonnegative(),
  filesRead: z.number().int().nonnegative(),
  /** denied + extension + size + cap */
  filesBlocked: z.number().int().nonnegative(),
  filesBlockedByReason: blockedByReasonSchema,
  filesSkippedBudget: z.number().int().nonnegative(),
});
export type AnalysisCounts = z.infer<typeof analysisCountsSchema>;

export const SIGNAL_KINDS = [
  "route",
  "webhook",
  "schedule",
  "queue_consumer",
  "messaging",
  "db_write",
  "ci_workflow",
  "env_var",
] as const;
export const signalKindSchema = z.enum(SIGNAL_KINDS);
export type SignalKind = z.infer<typeof signalKindSchema>;

/** Derived data only (paths, names, cron expressions), never source text. */
export const signalSchema = z.object({
  kind: signalKindSchema,
  filePath: z.string().min(1).max(1024),
  line: z.number().int().positive().nullable(),
  label: z.string().min(1).max(120),
});
export type Signal = z.infer<typeof signalSchema>;

export const MAX_SIGNALS = 500;

export const validationKindSchema = z.enum(["website", "app", "invalid"]);
export type ValidationKind = z.infer<typeof validationKindSchema>;

export const validationResultSchema = z.object({
  kind: validationKindSchema,
  reason: z.string().nullable(),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

/** GET /api/analyses/:id */
export const analysisSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  status: analysisStatusSchema,
  progress: z.number().int().min(0).max(100),
  /** Branch analyzed (copied from the project when the analysis started). */
  branch: z.string(),
  commitSha: z.string().nullable(),
  validation: validationResultSchema.nullable(),
  counts: analysisCountsSchema,
  signals: z.array(signalSchema).max(MAX_SIGNALS),
  errorCode: jobErrorCodeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const FINDING_CATEGORIES = [
  "committed_env_file",
  "hardcoded_secret",
  "private_key",
  "cloud_credentials",
  "service_account",
  "db_connection_string",
  "jwt_signing_secret",
  "webhook_secret_url",
  "ci_secret",
  "client_exposed_secret",
  "debug_config",
] as const;
export const findingCategorySchema = z.enum(FINDING_CATEGORIES);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

export const severitySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof severitySchema>;

export const findingSchema = z.object({
  id: uuidSchema,
  analysisId: uuidSchema,
  category: findingCategorySchema,
  severity: severitySchema,
  filePath: z.string(),
  line: z.number().int().positive().nullable(),
  maskedEvidence: z.string(),
  remediation: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;

/** POST /api/projects/:id/analyze (HTTP 202) */
export const analyzeResponseSchema = z.object({ analysisId: uuidSchema });
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

/** GET /api/projects/:id/findings */
export const findingsResponseSchema = z.object({
  analysisId: uuidSchema.nullable(),
  findings: z.array(findingSchema),
});
export type FindingsResponse = z.infer<typeof findingsResponseSchema>;

/** Optional `?analysisId=` of the findings and recommendations routes. */
export const analysisIdQuerySchema = z.object({
  analysisId: uuidSchema.optional(),
});
export type AnalysisIdQuery = z.infer<typeof analysisIdQuerySchema>;
