import { z } from "zod";

import {
  CREDENTIAL_NAMES,
  isAllowedNodeType,
  type AllowedNodeType,
} from "@/lib/n8n-catalog/allowlist";
import { uuidSchema } from "@/schemas/api";

/**
 * Recommendation schemas (docs/contract.md sections 6 and 7). Runtime-neutral.
 */

export const triggerKindSchema = z.enum(["webhook", "schedule", "manual"]);
export type TriggerKind = z.infer<typeof triggerKindSchema>;

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const recommendationStatusSchema = z.enum(["new", "selected", "generated"]);
export type RecommendationStatus = z.infer<typeof recommendationStatusSchema>;

export const allowedNodeTypeSchema = z.custom<AllowedNodeType>(
  (value) => typeof value === "string" && isAllowedNodeType(value),
  { message: "Unknown node type" },
);

export const credentialNameSchema = z.enum(CREDENTIAL_NAMES);

/** Free text from the model: plain text only, no control characters. */
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), {
      message: "Control characters are not allowed",
    });

export const MAX_DRAFTS = 20;

/**
 * RecommendationDraft: one item of the analysis model output (section 7).
 * `parseDrafts` (src/lib/analysis/prompt.ts) filters `source_files` and
 * `required_credentials` before this schema runs and drops drafts that fail.
 */
export const recommendationDraftSchema = z.object({
  title: plainText(3, 80),
  description: plainText(10, 600),
  trigger_kind: triggerKindSchema,
  confidence: z.number().min(0).max(1),
  source_files: z.array(z.string().min(1).max(1024)).max(50),
  required_credentials: z.array(credentialNameSchema).max(10),
  risk_level: riskLevelSchema,
  node_types: z.array(allowedNodeTypeSchema).min(1).max(40),
  rationale: plainText(10, 400),
});
export type RecommendationDraft = z.infer<typeof recommendationDraftSchema>;

/** Recommendation DTO (section 6). */
export const recommendationSchema = z.object({
  id: uuidSchema,
  analysisId: uuidSchema,
  title: z.string(),
  description: z.string(),
  triggerKind: triggerKindSchema,
  confidence: z.number().min(0).max(1),
  sourceFiles: z.array(z.string()),
  requiredCredentials: z.array(z.string()),
  riskLevel: riskLevelSchema,
  nodeTypes: z.array(z.string()),
  rationale: z.string(),
  estimatedTokens: z.number().int().nonnegative(),
  status: recommendationStatusSchema,
  /** null until Phase 3 generates a flow. */
  flowId: uuidSchema.nullable(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

/** GET /api/projects/:id/recommendations */
export const recommendationsResponseSchema = z.object({
  analysisId: uuidSchema.nullable(),
  recommendations: z.array(recommendationSchema),
});
export type RecommendationsResponse = z.infer<typeof recommendationsResponseSchema>;
