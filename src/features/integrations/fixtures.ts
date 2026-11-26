import type { AiProviderResponse } from "@/features/integrations/types";

/**
 * Sample data for the Phase 2e-ui preview (D-54): one `AiProviderResponse` per
 * "Preview state" option. Only sample `keyHint`s (prefix + "…" + 4 chars); never a
 * full key-shaped string. Every value passes the local schemas (fixtures.test.ts).
 */

export const PREVIEW_STATE_IDS = [
  "empty",
  "saved",
  "working",
  "invalid_key",
  "no_credit",
  "model_not_found",
  "no_response",
  "free_model",
] as const;
export type PreviewStateId = (typeof PREVIEW_STATE_IDS)[number];

const updatedAt = "2026-11-27T09:00:00.000Z";
const testedAt = "2026-11-27T09:05:00.000Z";

const openRouterBase = {
  provider: "openrouter",
  model: "anthropic/claude-haiku-5.5",
  keyHint: "sk-or-…4f2a",
  updatedAt,
} as const;

export const PREVIEW_STATES: Record<PreviewStateId, { label: string; response: AiProviderResponse }> = {
  empty: { label: "No key saved", response: { setting: null } },
  saved: { label: "Saved, not tested", response: { setting: { ...openRouterBase, lastTest: null } } },
  working: {
    label: "Working",
    response: { setting: { ...openRouterBase, lastTest: { result: "working", testedAt } } },
  },
  invalid_key: {
    label: "Invalid key",
    response: {
      setting: {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        keyHint: "sk-ant-…9c1e",
        updatedAt,
        lastTest: { result: "invalid_key", testedAt },
      },
    },
  },
  no_credit: {
    label: "No credit",
    response: { setting: { ...openRouterBase, lastTest: { result: "no_credit", testedAt } } },
  },
  model_not_found: {
    label: "Model not found",
    response: {
      setting: { ...openRouterBase, model: "vendor/unknown-model", lastTest: { result: "model_not_found", testedAt } },
    },
  },
  no_response: {
    label: "Provider did not respond",
    response: { setting: { ...openRouterBase, lastTest: { result: "no_response", testedAt } } },
  },
  free_model: {
    label: "Free model",
    response: {
      setting: { ...openRouterBase, model: "vendor/model:free", lastTest: { result: "working", testedAt } },
    },
  },
};
