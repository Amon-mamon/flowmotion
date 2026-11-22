import { z } from "zod";

import { combineSignals, isRetryableStatus, type FetchLike } from "@/lib/analysis/model/http";
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
 * with Zod. Errors carry the HTTP status only: request and response bodies
 * and the key are never logged or attached.
 */

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_TIMEOUT_MS = 55_000;

const openRouterResponseSchema = z.object({
  choices: z.array(
    z.object({ message: z.object({ content: z.string() }).loose() }).loose(),
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
  return {
    async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
      let response: Response;
      try {
        response = await doFetch(OPENROUTER_CHAT_URL, {
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
          signal: combineSignals(options.timeoutMs ?? OPENROUTER_TIMEOUT_MS, input.signal),
        });
      } catch {
        throw new ModelProviderError("Model request failed (network or timeout)", null, true);
      }
      if (!response.ok) {
        throw new ModelProviderError(
          `Model request failed with status ${response.status}`,
          response.status,
          isRetryableStatus(response.status),
        );
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new ModelProviderError("Model response was not JSON", response.status, true);
      }
      if (errorBodySchema.safeParse(json).success) {
        throw new ModelProviderError("Model response reported an error", response.status, true);
      }
      const parsed = openRouterResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ModelProviderError("Model response had an unexpected shape", response.status, true);
      }
      const first = parsed.data.choices[0];
      const text = first === undefined ? "" : first.message.content;
      const usage = parsed.data.usage;
      return {
        text,
        tokensIn: usage?.prompt_tokens ?? estimateTokens(input.system.length + input.prompt.length),
        tokensOut: usage?.completion_tokens ?? estimateTokens(text.length),
      };
    },
  };
}
