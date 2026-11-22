import { z } from "zod";

import { combineSignals, isRetryableStatus, type FetchLike } from "@/lib/analysis/model/http";
import {
  ModelProviderError,
  type AnalysisModel,
  type AnalyzeInput,
  type AnalyzeOutput,
} from "@/lib/analysis/model/types";

/**
 * Anthropic Messages API adapter (plain fetch, no SDK, D-16). The response is
 * validated with Zod. Errors carry the HTTP status only: request and response
 * bodies are never logged or attached.
 */

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_TIMEOUT_MS = 55_000;

export type { FetchLike };

const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({ type: z.string(), text: z.string().optional() }).loose(),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }).loose(),
  stop_reason: z.string().nullable().optional(),
}).loose();

export interface AnthropicModelOptions {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createAnthropicModel(options: AnthropicModelOptions): AnalysisModel {
  const doFetch = options.fetch ?? fetch;
  return {
    async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
      let response: Response;
      try {
        response = await doFetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: input.maxOutputTokens,
            system: input.system,
            messages: [{ role: "user", content: input.prompt }],
          }),
          signal: combineSignals(options.timeoutMs ?? ANTHROPIC_TIMEOUT_MS, input.signal),
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
      const parsed = anthropicResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ModelProviderError("Model response had an unexpected shape", response.status, true);
      }
      const text = parsed.data.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("");
      return {
        text,
        tokensIn: parsed.data.usage.input_tokens,
        tokensOut: parsed.data.usage.output_tokens,
      };
    },
  };
}
