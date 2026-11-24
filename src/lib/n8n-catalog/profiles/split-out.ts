import { z } from "zod";

import { fieldPathSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const splitOutProfile = defineProfile({
  name: "splitOut",
  tier: 1,
  typeVersion: 1.1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({ field: fieldPathSchema }),
  toParameters: (params) => ({ fieldToSplitOut: params.field, include: "noOtherFields", options: {} }),
  promptReference: "splitOut: turns an array field into one item per element. params: { field: FieldPath }",
});
