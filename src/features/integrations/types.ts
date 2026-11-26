import { z } from "zod";

import { isoDateTimeSchema } from "@/schemas/api";

/**
 * Local copies of the future Phase 2e DTOs (docs/contract.md section 6,
 * "Phase 2e, NOT BUILT"; D-54). Names and fields match the contract exactly.
 * The full Phase 2e replaces this file with imports from
 * `src/schemas/ai-provider.ts` (backend-owned).
 */

export const aiProviderIdSchema = z.enum(["openrouter", "anthropic"]);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const aiModelIdSchema = z
  .string()
  .trim()
  .min(1, "Enter a model name.")
  .max(200, "Use at most 200 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/, "Use letters, numbers, and . _ : / @ - only.");
export type AiModelId = z.infer<typeof aiModelIdSchema>;

export const aiTestResultSchema = z.enum([
  "working",
  "invalid_key",
  "no_credit",
  "model_not_found",
  "no_response",
]);
export type AiTestResult = z.infer<typeof aiTestResultSchema>;

/** Fixed key prefix per provider; `keyHint` is this prefix, "…", and the last 4 chars. */
export const AI_KEY_PREFIX: Record<AiProviderId, string> = {
  openrouter: "sk-or-",
  anthropic: "sk-ant-",
};

export const aiProviderSettingSchema = z.object({
  provider: aiProviderIdSchema,
  model: aiModelIdSchema,
  keyHint: z.string().regex(/^sk-(or|ant)-…\S{4}$/),
  lastTest: z.object({ result: aiTestResultSchema, testedAt: isoDateTimeSchema }).nullable(),
  updatedAt: isoDateTimeSchema,
});
export type AiProviderSetting = z.infer<typeof aiProviderSettingSchema>;

export const aiProviderResponseSchema = z.object({ setting: aiProviderSettingSchema.nullable() });
export type AiProviderResponse = z.infer<typeof aiProviderResponseSchema>;

const aiProviderPutBodyObject = z.object({
  provider: aiProviderIdSchema,
  model: aiModelIdSchema,
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(300)
    .regex(/^\S+$/)
    .optional(),
});

export const aiProviderPutBodySchema = aiProviderPutBodyObject.superRefine((body, ctx) => {
  if (body.apiKey !== undefined && !body.apiKey.startsWith(AI_KEY_PREFIX[body.provider])) {
    ctx.addIssue({ code: "custom", path: ["apiKey"], message: "This key does not match the provider." });
  }
});
export type AiProviderPutBody = z.infer<typeof aiProviderPutBodySchema>;

/**
 * Form schema: `AiProviderPutBody` minus `apiKey` (contract Phase 2e-ui item 4).
 * The API key input is never part of any form state.
 */
export const aiProviderFormSchema = aiProviderPutBodyObject.omit({ apiKey: true });
export type AiProviderFormValues = z.infer<typeof aiProviderFormSchema>;

export const aiProviderTestResponseSchema = z.object({
  result: aiTestResultSchema,
  testedAt: isoDateTimeSchema,
});
export type AiProviderTestResponse = z.infer<typeof aiProviderTestResponseSchema>;
