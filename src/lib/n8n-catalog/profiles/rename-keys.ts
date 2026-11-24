import { z } from "zod";

import { fieldNameSchema, fieldPathSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const renameKeysProfile = defineProfile({
  name: "renameKeys",
  tier: 1,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({
    keys: z
      .array(z.strictObject({ from: fieldPathSchema, to: fieldNameSchema }))
      .min(1)
      .max(20),
  }),
  toParameters: (params) => ({
    keys: { key: params.keys.map((item) => ({ currentKey: item.from, newKey: item.to })) },
  }),
  promptReference: "renameKeys: renames fields. params: { keys: { from: FieldPath, to: FieldName }[1..20] }",
});
