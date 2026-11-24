import { z } from "zod";

import { jsonValueSchema } from "@/schemas/flow";
import { allowedNodeTypeSchema, credentialNameSchema } from "@/schemas/recommendation";

/**
 * FlowSpec: the internal flow format (docs/contract.md section 7, Phase 3a).
 * The model returns a `FlowSpecDraft`; code computes `requiredCredentials`.
 * Every object is strict (unknown keys fail). The semantic rules F1..F12 live
 * in `src/lib/flowspec/` (`checkFlowSpec`). Runtime-neutral.
 */

export const NODE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const NODE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
export const MAX_FLOW_NODES = 40;
export const MAX_FLOWSPEC_BYTES = 256 * 1024;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Free text from the model: plain text only, no control characters. */
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_CHARS.test(value), {
      message: "Control characters are not allowed",
    });

export const nodeKeySchema = z.string().regex(NODE_KEY_PATTERN);
export const nodeLabelSchema = z.string().regex(NODE_LABEL_PATTERN);

/** TestSpec (docs/testing.md). Shape-checked in Phase 3 (rule F11), executed from Phase 4. */
export const testCaseSchema = z.strictObject({
  name: plainText(1, 120),
  trigger: z.strictObject({
    kind: z.enum(["manual", "webhook", "schedule"]),
    payload: jsonValueSchema,
  }),
  /** Responses for tier-2 nodes, keyed by node key. */
  mocks: z.record(z.string(), jsonValueSchema),
  expect: z.strictObject({
    reachedNodes: z.array(z.string()).max(MAX_FLOW_NODES),
    notReachedNodes: z.array(z.string()).max(MAX_FLOW_NODES).optional(),
    /** Partial match, keyed by node key. */
    outputs: z.record(z.string(), jsonValueSchema).optional(),
  }),
});
export type TestCase = z.infer<typeof testCaseSchema>;

export const testSpecSchema = z.strictObject({
  cases: z.array(testCaseSchema).max(20),
});
export type TestSpec = z.infer<typeof testSpecSchema>;

export const flowSpecNodeSchema = z.strictObject({
  key: nodeKeySchema,
  nodeType: allowedNodeTypeSchema,
  /** Becomes the n8n node name. */
  label: nodeLabelSchema,
  /** Must pass the node profile's strict schema (rule F7). */
  params: z.record(z.string(), jsonValueSchema),
  sourceFiles: z.array(z.string().min(1).max(1024)).max(50).optional(),
  notes: plainText(0, 300).optional(),
});
export type FlowSpecNode = z.infer<typeof flowSpecNodeSchema>;

export const flowSpecEdgeSchema = z.strictObject({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  /** Output index for IF / Switch / SplitInBatches (default 0). */
  output: z.number().int().min(0).max(16).optional(),
  /** Input index for Merge (default 0). */
  input: z.number().int().min(0).max(16).optional(),
});
export type FlowSpecEdge = z.infer<typeof flowSpecEdgeSchema>;

/** Model output. Counts and uniqueness are rules F1..F12, not Zod, so a failure carries a rule id. */
export const flowSpecDraftSchema = z.strictObject({
  version: z.literal(1),
  name: plainText(3, 80),
  description: plainText(10, 600),
  nodes: z.array(flowSpecNodeSchema).max(200),
  edges: z.array(flowSpecEdgeSchema).max(400),
  tests: testSpecSchema,
});
export type FlowSpecDraft = z.infer<typeof flowSpecDraftSchema>;

export const requiredCredentialSchema = z.strictObject({
  type: credentialNameSchema,
  /** Node keys. */
  usedBy: z.array(z.string()),
});
export type RequiredCredential = z.infer<typeof requiredCredentialSchema>;

/** Stored in `flows.flow_spec`. `requiredCredentials` is computed by code, never taken from the model. */
export const flowSpecSchema = flowSpecDraftSchema.extend({
  requiredCredentials: z.array(requiredCredentialSchema),
});
export type FlowSpec = z.infer<typeof flowSpecSchema>;
