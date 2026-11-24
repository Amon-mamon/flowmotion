import { z } from "zod";

import { pairSchema, uniqueNames } from "@/lib/flowspec/values";

import { defineProfile, one, stableId, unnamed } from "./types";

export const setProfile = defineProfile({
  name: "set",
  tier: 1,
  typeVersion: 3.5,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({
    fields: z.array(pairSchema).min(1).max(20).refine(uniqueNames, { message: "Duplicate field name" }),
    keepOtherFields: z.boolean(),
  }),
  toParameters: (params) => ({
    mode: "manual",
    assignments: {
      assignments: params.fields.map((field, index) => ({
        id: stableId(`assignment:${index}`),
        name: field.name,
        value: field.value,
        type: typeof field.value === "number" ? "number" : typeof field.value === "boolean" ? "boolean" : "string",
      })),
    },
    includeOtherFields: params.keepOtherFields,
    options: {},
  }),
  promptReference:
    "set: adds or edits fields on each item. params: { fields: Pair[1..20], keepOtherFields: boolean }",
});
