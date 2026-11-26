import type { AiProviderId, AiTestResult } from "@/features/integrations/types";

/**
 * User-facing copy for the Integrations page. Every string is fixed by
 * docs/design.md "Integrations page" (D-54); change them only with the architect.
 */
export const INTEGRATIONS_COPY = {
  pageTitle: "Integrations",
  pageDescription: "Connect services that Flow Motion uses on your behalf.",
  cardTitle: "AI provider",
  explanation:
    "Flow Motion uses its built-in AI by default. Add your own OpenRouter or Anthropic key to use your provider and model instead, for analyses and flow generation of your own repositories. Your provider then receives the same redacted code snippets under your account and its terms. If your key stops working, the job stops with an error. Flow Motion does not switch back to its built-in AI on its own.",

  // Preview notice (only while isAiProviderApiReady() is false)
  previewTitle: "Preview — keys are not saved yet",
  previewBody: "This shows how your own AI key will work. Nothing you type here is saved or sent anywhere.",
  previewStateLabel: "Preview state",
  comingSoon: "Coming soon",

  // Empty state
  emptyText: "No API key saved. The built-in AI is used.",
  addKey: "Add API key",

  // Form
  providerLabel: "Provider",
  keyHelperNew: "Stored encrypted. It is never shown again after you save it.",
  keyHelperKeep: "Leave empty to keep the saved key.",
  modelLabel: "Model",
  freeModelWarning:
    "Free models may log or train on what they receive, including redacted snippets of your code. Use a paid model for private code.",
  saveKey: "Save key",
  saving: "Saving…",
  cancel: "Cancel",

  // Saved state
  rowProvider: "Provider",
  rowModel: "Model",
  rowApiKey: "API key",
  rowLastTest: "Last test",
  notTested: "Not tested yet",
  testConnection: "Test connection",
  testing: "Testing…",
  change: "Change",
  removeKey: "Remove key",

  // Remove confirm
  removeTitle: "Remove your API key?",
  removeBody: "Flow Motion deletes your key. New analyses and flows use the built-in AI again.",
} as const;

export const PROVIDER_COPY: Record<
  AiProviderId,
  { name: string; keyLabel: string; keyPlaceholder: string; suggestedModel: string }
> = {
  openrouter: {
    name: "OpenRouter",
    keyLabel: "OpenRouter API key",
    keyPlaceholder: "sk-or-…",
    // Suggested default; the owner may change it (OQ-31).
    suggestedModel: "anthropic/claude-haiku-5.5",
  },
  anthropic: {
    name: "Anthropic",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-…",
    suggestedModel: "claude-haiku-5-5",
  },
};

export function modelHint(suggestedModel: string): string {
  return `Any model your provider offers can be used, free or paid. Suggested: ${suggestedModel}.`;
}

export const TEST_RESULT_COPY: Record<AiTestResult, { title: string; sentence: string }> = {
  working: { title: "Working", sentence: "Your key and model answered a test request." },
  invalid_key: { title: "Invalid key", sentence: "The provider rejected this key. Check it and save it again." },
  no_credit: {
    title: "No credit",
    sentence: "Your provider account has no credit left. Add credit with the provider, then test again.",
  },
  model_not_found: { title: "Model not found", sentence: "The provider does not offer this model. Check the model name." },
  no_response: { title: "Provider did not respond", sentence: "Try again in a minute." },
};

export function testedLine(relative: string): string {
  return `Tested ${relative}`;
}
