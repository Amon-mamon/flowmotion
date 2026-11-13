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
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}

/** Provider failure. Carries an HTTP status or a short code only, never response bodies. */
export class ModelProviderError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "ModelProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}
