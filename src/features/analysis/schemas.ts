// Shared Phase 2 DTO schemas owned by backend (src/schemas, docs/contract.md section 6).
// The frontend imports them through this file so components keep stable names.
export {
  ANALYSIS_STATUSES,
  analysisStatusSchema,
  analysisCountsSchema,
  SIGNAL_KINDS,
  signalKindSchema,
  signalSchema,
  validationResultSchema as validationSchema,
  analysisSchema,
  FINDING_CATEGORIES,
  findingCategorySchema,
  severitySchema,
  findingSchema,
  analyzeResponseSchema,
  findingsResponseSchema,
} from "@/schemas/analysis";
export type {
  AnalysisStatus,
  AnalysisCounts,
  SignalKind,
  Signal,
  ValidationResult as Validation,
  Analysis,
  FindingCategory,
  Severity,
  Finding,
  AnalyzeResponse,
  FindingsResponse,
} from "@/schemas/analysis";
export { JOB_ERROR_CODES, jobErrorCodeSchema, type JobErrorCode } from "@/schemas/api";
export {
  recommendationSchema,
  recommendationsResponseSchema,
  type Recommendation,
  type RecommendationsResponse,
  type TriggerKind,
} from "@/schemas/recommendation";

import { isActiveAnalysisStatus, type AnalysisStatus } from "@/schemas/analysis";

/** `queued`..`analyzing`: the job is still running and the UI polls. */
export function isActiveStatus(status: AnalysisStatus): boolean {
  return isActiveAnalysisStatus(status);
}

/** `done`, `failed`, `rejected`: polling stops. */
export function isTerminalStatus(status: AnalysisStatus): boolean {
  return !isActiveAnalysisStatus(status);
}
