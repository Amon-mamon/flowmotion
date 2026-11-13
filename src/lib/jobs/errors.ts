import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import type { JobErrorCode } from "@/schemas/api";

/**
 * A step failure with its job-level code. Non-retryable codes end the job at
 * once without backoff (contract section 5); retryable ones back off.
 * Carries a code only, never repository text or provider bodies.
 */
export class StepError extends Error {
  readonly code: JobErrorCode;
  readonly retryable: boolean;

  constructor(code: JobErrorCode, retryable: boolean, message?: string) {
    super(message ?? code);
    this.name = "StepError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const accessLost = () => new StepError("GITHUB_ACCESS_LOST", false);

/**
 * GitHub failures: 401/403/404 → GITHUB_ACCESS_LOST (installation removed or
 * repo unreadable, not retried); 429/5xx/network/shape → retryable INTERNAL.
 */
export function toStepError(error: unknown): StepError {
  if (error instanceof StepError) return error;
  if (error instanceof GitHubApiError) {
    if ([401, 403, 404].includes(error.status)) return accessLost();
    return new StepError("INTERNAL", true, `GitHub ${error.operation} status ${error.status}`);
  }
  if (error instanceof GitHubResponseError) return new StepError("INTERNAL", true, "GitHub payload");
  return new StepError("INTERNAL", true, error instanceof Error ? error.name : "unknown");
}
