import { z } from "zod";

import { fieldNameSchema, textSchema, uniqueNames } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

/**
 * `LiteralPair` (D-52, OQ-29 / S3a-7): the reply is one JSON text at the
 * pinned n8n, so a runtime value could break it or let the webhook caller add
 * keys. Values are `Text` without `{{` (a `{{` fails F7), numbers, or booleans.
 */
export const LITERAL_RULE_MESSAGE = "Literal value: no {{ }} expressions";

export const literalPairSchema = z.strictObject({
  name: fieldNameSchema,
  value: z.union([
    textSchema.refine((value) => !value.includes("{{"), { message: LITERAL_RULE_MESSAGE }),
    z.number().refine(Number.isFinite),
    z.boolean(),
  ]),
});
export type LiteralPair = z.infer<typeof literalPairSchema>;

export const respondToWebhookProfile = defineProfile({
  name: "respondToWebhook",
  tier: 1,
  typeVersion: 1.5,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({
    statusCode: z.number().int().min(200).max(599),
    body: z.array(literalPairSchema).max(20).refine(uniqueNames, { message: "Duplicate field name" }),
  }),
  toParameters: (params) => ({
    respondWith: "json",
    // Every value is a literal, so the whole body is plain JSON text (never an expression).
    responseBody: `{${params.body.map((pair) => `${JSON.stringify(pair.name)}: ${JSON.stringify(pair.value)}`).join(", ")}}`,
    options: { responseCode: params.statusCode },
  }),
  promptReference:
    'respondToWebhook: replies to the webhook caller with fixed JSON; only in a flow whose webhook has respond "respondNode". params: { statusCode: integer 200..599, body: LiteralPair[0..20] } where LiteralPair = { name: FieldName, value: text without "{{" | number | boolean } (literal values only, never expressions)',
});
