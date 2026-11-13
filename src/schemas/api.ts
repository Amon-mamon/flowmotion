import { z } from "zod";

/**
 * API envelope and stable error codes (docs/contract.md section 6).
 * Runtime-neutral: shared by route handlers, the worker and the frontend.
 */

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "GITHUB_REFRESH_REQUIRED",
  "RATE_LIMITED",
  "DAILY_CAP_REACHED",
  "PROJECT_STALE_ANALYSIS",
  "EXPORT_NOT_VALID",
  "INTERNAL",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** HTTP status for each error code (contract section 6). */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  GITHUB_REFRESH_REQUIRED: 403,
  RATE_LIMITED: 429,
  DAILY_CAP_REACHED: 429,
  PROJECT_STALE_ANALYSIS: 409,
  EXPORT_NOT_VALID: 409,
  INTERNAL: 500,
};

/** Job-level codes stored on analyses/flows rows, never an HTTP response. */
export const JOB_ERROR_CODES = [
  "PROJECT_INVALID",
  "AI_DISABLED",
  "GITHUB_ACCESS_LOST",
  "BRANCH_NOT_FOUND",
  "MODEL_OUTPUT_INVALID",
  "GENERATION_EXHAUSTED",
  /** D-29: the job made no progress for 1 hour and was expired. */
  "JOB_EXPIRED",
  "INTERNAL",
] as const;
export const jobErrorCodeSchema = z.enum(JOB_ERROR_CODES);
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>;

export const apiErrorBodySchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export const apiFailureSchema = z.object({
  ok: z.literal(false),
  error: apiErrorBodySchema,
});
export type ApiFailure = z.infer<typeof apiFailureSchema>;

/** Builds the success envelope schema for a given data schema. */
export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

/** Full envelope schema for a given data schema. */
export function apiResponseSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [apiSuccessSchema(data), apiFailureSchema]);
}

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Shared primitives. */
export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** `{ deleted: true }` responses. */
export const deletedSchema = z.object({ deleted: z.literal(true) });
export type Deleted = z.infer<typeof deletedSchema>;

/** `{ signedOut: true }` response of POST /api/auth/sign-out. */
export const signedOutSchema = z.object({ signedOut: z.literal(true) });
export type SignedOut = z.infer<typeof signedOutSchema>;

/** `{ received: true }` webhook acknowledgement. */
export const receivedSchema = z.object({ received: z.literal(true) });
export type Received = z.infer<typeof receivedSchema>;
