import { z } from "zod";

import { parseTemplate } from "@/lib/flowspec/expression";
import { pairSchema, uniqueNames, type Value } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

/**
 * A JSON string literal for `text`. Literal parts are JSON-escaped; `{{ … }}`
 * parts are kept as written so n8n can evaluate them before parsing the body.
 */
function jsonTemplateString(text: string): string {
  const parsed = parseTemplate(text);
  if (!parsed.ok) return JSON.stringify(text);
  const inner = parsed.segments
    .map((segment) => (segment.kind === "literal" ? JSON.stringify(segment.text).slice(1, -1) : segment.text))
    .join("");
  return `"${inner}"`;
}

function jsonTemplateValue(value: Value): string {
  return typeof value === "string" ? jsonTemplateString(value) : JSON.stringify(value);
}

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
    body: z.array(pairSchema).max(20).refine(uniqueNames, { message: "Duplicate field name" }),
  }),
  toParameters: (params) => ({
    respondWith: "json",
    responseBody: `{${params.body
      .map((pair) => `${JSON.stringify(pair.name)}: ${jsonTemplateValue(pair.value)}`)
      .join(", ")}}`,
    options: { responseCode: params.statusCode },
  }),
  promptReference:
    'respondToWebhook: replies to the webhook caller with JSON; only in a flow whose webhook has respond "respondNode". params: { statusCode: integer 200..599, body: Pair[0..20] }',
});
