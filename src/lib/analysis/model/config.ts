/**
 * AI kill switch (contract section 10, D-16). This is the single place that
 * reads ANALYSIS_MODEL and ANTHROPIC_API_KEY. AI is enabled only when
 * ANALYSIS_MODEL is a model id (trimmed, non-empty, not "disabled" in any
 * case) AND ANTHROPIC_API_KEY is non-empty. A missing value means disabled.
 */

export type ModelConfig =
  | { enabled: false }
  | { enabled: true; provider: "anthropic"; model: string; apiKey: string };

export type ModelEnvSource = Readonly<Record<string, string | undefined>>;

export const DISABLED_MODEL_VALUE = "disabled";

/** True when ANALYSIS_MODEL is missing, empty, or "disabled" (any case). */
export function isAnalysisModelDisabled(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed.toLowerCase() === DISABLED_MODEL_VALUE;
}

export function resolveModelConfig(env: ModelEnvSource): ModelConfig {
  const model = env.ANALYSIS_MODEL;
  const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (isAnalysisModelDisabled(model) || apiKey === "") return { enabled: false };
  return { enabled: true, provider: "anthropic", model: (model ?? "").trim(), apiKey };
}
