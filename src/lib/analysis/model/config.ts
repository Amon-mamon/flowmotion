/**
 * AI provider selection and kill switch (contract section 10, D-16, D-24,
 * D-33). This is the single place that reads ANALYSIS_PROVIDER,
 * ANALYSIS_MODEL, ANTHROPIC_API_KEY and OPENROUTER_API_KEY.
 *
 * AI is enabled only when ANALYSIS_PROVIDER is "anthropic" or "openrouter",
 * ANALYSIS_MODEL is a model id (trimmed, non-empty, not "disabled" in any
 * case), and the provider's key is non-empty. OpenRouter is development-only:
 * it additionally requires runner === "local" (checked first; "edge" refuses
 * unconditionally), NODE_ENV not "production", and APP_URL on localhost.
 * Every failure is `{ enabled: false }` (fail closed). An OpenRouter guard
 * refusal is logged once by code AI_PROVIDER_REFUSED, never with values.
 */

export type ModelProvider = "anthropic" | "openrouter";

/** Who resolves the config: the in-process local runner or the Edge worker (D-33). */
export type ModelRunner = "local" | "edge";

export type ModelConfig =
  | { enabled: false }
  | { enabled: true; provider: ModelProvider; model: string; apiKey: string };

export type ModelEnvSource = Readonly<Record<string, string | undefined>>;

export const DISABLED_MODEL_VALUE = "disabled";
export const DISABLED_PROVIDER_VALUE = "disabled";
export const ANALYSIS_PROVIDER_VALUES = ["disabled", "anthropic", "openrouter"] as const;
export const AI_PROVIDER_REFUSED = "AI_PROVIDER_REFUSED";

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when ANALYSIS_MODEL is missing, empty, or "disabled" (any case). */
export function isAnalysisModelDisabled(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed.toLowerCase() === DISABLED_MODEL_VALUE;
}

/** ANALYSIS_PROVIDER as a provider; missing, empty, or unknown = null (disabled). */
export function parseAnalysisProvider(value: string | undefined): ModelProvider | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "anthropic" || trimmed === "openrouter" ? trimmed : null;
}

function isLocalAppUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return LOCAL_HOSTNAMES.has(url.hostname);
}

function refuseOpenRouter(): ModelConfig {
  // Code only: never the reason, the key, the model id, or any env value.
  console.warn(`[model] ${AI_PROVIDER_REFUSED}`);
  return { enabled: false };
}

export function resolveModelConfig(env: ModelEnvSource, runner: ModelRunner): ModelConfig {
  const provider = parseAnalysisProvider(env.ANALYSIS_PROVIDER);
  if (provider === null) return { enabled: false };

  // D-33: the Edge worker never uses OpenRouter, whatever the env says.
  if (provider === "openrouter" && runner !== "local") return refuseOpenRouter();

  const model = env.ANALYSIS_MODEL;
  if (isAnalysisModelDisabled(model)) return { enabled: false };
  const apiKey = ((provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENROUTER_API_KEY) ?? "").trim();
  if (apiKey === "") return { enabled: false };

  if (provider === "openrouter") {
    const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
    if (nodeEnv === "production" || !isLocalAppUrl(env.APP_URL)) return refuseOpenRouter();
  }
  return { enabled: true, provider, model: (model ?? "").trim(), apiKey };
}
