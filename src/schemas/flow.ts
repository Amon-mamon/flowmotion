import { z } from "zod";

import { isoDateTimeSchema, jobErrorCodeSchema, uuidSchema } from "@/schemas/api";

/**
 * Flow DTOs (docs/contract.md section 6, Phase 3a). Runtime-neutral: shared by
 * route handlers, the worker and the frontend. camelCase throughout.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Deepest nesting a JSON value may have before it is refused. */
export const JSON_MAX_DEPTH = 32;

/**
 * True when `value` is plain JSON (finite numbers, plain objects, arrays) no
 * deeper than `maxDepth`. Iterative, so hostile nesting cannot overflow the
 * stack.
 */
export function isJsonValue(value: unknown, maxDepth: number = JSON_MAX_DEPTH): value is JsonValue {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const item = current.value;
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item !== "object") return false;
    if (current.depth >= maxDepth) return false;
    if (Array.isArray(item)) {
      for (const child of item) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    const proto: unknown = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) return false;
    for (const child of Object.values(item)) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

export const jsonValueSchema = z.custom<JsonValue>((value) => isJsonValue(value), {
  message: "Not a JSON value",
});

export const FLOW_STATUSES = ["generating", "ready", "failed"] as const;
export const flowStatusSchema = z.enum(FLOW_STATUSES);
export type FlowStatus = z.infer<typeof flowStatusSchema>;

const checklistEntrySchema = z.object({
  /** Catalog credential name ("Slack") or placeholder token ("YOUR_SLACK_CHANNEL"). */
  name: z.string(),
  /** Node labels. */
  usedBy: z.array(z.string()),
});

/** Built by the compiler, never by the model (section 8). */
export const setupChecklistSchema = z.object({
  credentials: z.array(checklistEntrySchema),
  placeholders: z.array(checklistEntrySchema),
  /** Fixed sentences chosen by code. */
  warnings: z.array(z.string()),
});
export type SetupChecklist = z.infer<typeof setupChecklistSchema>;

export const flowNodeViewSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Full n8n type, for example "n8n-nodes-base.slack". */
  nodeType: z.string(),
  tier: z.union([z.literal(1), z.literal(2)]),
  isTrigger: z.boolean(),
  /** FlowSpec params, read-only. */
  params: z.record(z.string(), jsonValueSchema),
  credential: z.string().nullable(),
  sourceFiles: z.array(z.string()),
  notes: z.string().nullable(),
  position: z.object({ x: z.number(), y: z.number() }),
  inputs: z.number().int().nonnegative(),
  outputs: z.number().int().nonnegative(),
  /** length = outputs; "" when unnamed. */
  outputLabels: z.array(z.string()),
});
export type FlowNodeView = z.infer<typeof flowNodeViewSchema>;

export const flowEdgeViewSchema = z.object({
  /** "<from>:<output>-><to>:<input>" */
  id: z.string(),
  from: z.string(),
  to: z.string(),
  output: z.number().int().nonnegative(),
  input: z.number().int().nonnegative(),
});
export type FlowEdgeView = z.infer<typeof flowEdgeViewSchema>;

/** Phase 4 extends it; always null on a flow in Phase 3. */
export const testRunSummarySchema = z.object({
  id: uuidSchema,
  level: z.enum(["valid", "simulated"]),
  passed: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type TestRunSummary = z.infer<typeof testRunSummarySchema>;

/** GET /api/flows/:id */
export const flowDetailSchema = z.object({
  id: uuidSchema,
  recommendationId: uuidSchema,
  analysisId: uuidSchema,
  projectId: uuidSchema,
  repoFullName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: flowStatusSchema,
  errorCode: jobErrorCodeSchema.nullable(),
  n8nVersion: z.string().nullable(),
  catalogVersion: z.string().nullable(),
  importVerified: z.boolean(),
  /** [] unless ready. */
  nodes: z.array(flowNodeViewSchema),
  edges: z.array(flowEdgeViewSchema),
  /** null unless ready. */
  checklist: setupChecklistSchema.nullable(),
  latestTestRun: testRunSummarySchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type FlowDetail = z.infer<typeof flowDetailSchema>;

export const flowSummarySchema = z.object({
  id: uuidSchema,
  recommendationId: uuidSchema,
  analysisId: uuidSchema,
  projectId: uuidSchema,
  repoFullName: z.string(),
  name: z.string(),
  status: flowStatusSchema,
  errorCode: jobErrorCodeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type FlowSummary = z.infer<typeof flowSummarySchema>;

/** GET /api/flows */
export const flowsResponseSchema = z.object({ flows: z.array(flowSummarySchema) });
export type FlowsResponse = z.infer<typeof flowsResponseSchema>;

/** POST /api/recommendations/generate body: 1..8 unique uuids. */
export const generateBodySchema = z.object({
  recommendationIds: z
    .array(uuidSchema)
    .min(1)
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Recommendation ids must be unique",
    }),
  allowStale: z.boolean().optional(),
});
export type GenerateBody = z.infer<typeof generateBodySchema>;

/** Same order as `recommendationIds`. */
export const generateResponseSchema = z.object({ flowIds: z.array(uuidSchema) });
export type GenerateResponse = z.infer<typeof generateResponseSchema>;
