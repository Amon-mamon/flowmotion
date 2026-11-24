import { z } from "zod";

import { combineSignals, postModelJson, type FetchLike } from "@/lib/analysis/model/http";
import {
  ModelProviderError,
  type AnalysisModel,
  type AnalyzeInput,
  type AnalyzeOutput,
} from "@/lib/analysis/model/types";

/**
 * OpenRouter chat completions adapter (development only, D-24, D-33; plain
 * fetch, no SDK). Only `createModelFromEnv` builds it, and only after
 * `resolveModelConfig(env, "local")` allowed it. The response is validated
 * with Zod. Errors carry a fixed reason and the HTTP status only (D-35):
 * request and response bodies and the key are never logged or attached.
 */

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** D-35: slow free models need up to 100 s; the `ai` step budget is this + 5 s. */
export const OPENROUTER_TIMEOUT_MS = 100_000;

const openRouterResponseSchema = z.object({
  choices: z.array(
    z.object({ message: z.object({ content: z.string().nullish() }).loose() }).loose(),
  ).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }).loose().optional(),
}).loose();

const errorBodySchema = z.object({ error: z.object({}).loose() }).loose();

export interface OpenRouterModelOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** Same estimate as the token budget (D-17). */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

export function createOpenRouterModel(options: OpenRouterModelOptions): AnalysisModel {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
  return {
    timeoutMs,
    async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
      const { status, json } = await postModelJson(
        doFetch,
        OPENROUTER_CHAT_URL,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: input.maxOutputTokens,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.prompt },
            ],
          }),
        },
        combineSignals(timeoutMs, input.signal),
      );
      if (errorBodySchema.safeParse(json).success) {
        throw new ModelProviderError("error_body", status, true);
      }
      const parsed = openRouterResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ModelProviderError("bad_shape", status, true);
      }
      // D-35 (c): null or missing content becomes "", which the worker ends as MODEL_OUTPUT_INVALID.
      const text = parsed.data.choices[0]?.message.content ?? "";
      const usage = parsed.data.usage;
      return {
        text,
        tokensIn: usage?.prompt_tokens ?? estimateTokens(input.system.length + input.prompt.length),
        tokensOut: usage?.completion_tokens ?? estimateTokens(text.length),
      };
    },
  };
}
