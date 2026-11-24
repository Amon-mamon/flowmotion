/**
 * Provider interface for the analysis model (D-16). The model has no tools
 * and cannot fetch URLs; it only turns a prompt into text.
 */

export interface AnalyzeInput {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface AnalyzeOutput {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AnalysisModel {
  /** The adapter's effective request timeout; the worker derives the `ai` step budget from it (D-35). */
  readonly timeoutMs: number;
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}

/** Why a provider call failed (D-35). A fixed enum, safe to log. */
export type ModelFailureReason = "timeout" | "network" | "http" | "not_json" | "error_body" | "bad_shape";

const REASON_MESSAGES: Record<ModelFailureReason, string> = {
  timeout: "Model request timed out",
  network: "Model request failed (network)",
  http: "Model request failed with an HTTP error status",
  not_json: "Model response was not JSON",
  error_body: "Model response reported an error",
  bad_shape: "Model response had an unexpected shape",
};

/**
 * Provider failure. Carries a fixed reason, an HTTP status, and whether it is
 * retryable only; the message is fixed per reason and never contains a body,
 * prompt, key, or model id.
 */
export class ModelProviderError extends Error {
  readonly reason: ModelFailureReason;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(reason: ModelFailureReason, status: number | null, retryable: boolean) {
    super(REASON_MESSAGES[reason]);
    this.name = "ModelProviderError";
    this.reason = reason;
    this.status = status;
    this.retryable = retryable;
  }
}
