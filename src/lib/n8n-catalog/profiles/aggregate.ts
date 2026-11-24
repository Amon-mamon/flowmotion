import { z } from "zod";

import { fieldNameSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const aggregateProfile = defineProfile({
  name: "aggregate",
  tier: 1,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({ as: fieldNameSchema }),
  toParameters: (params) => ({
    aggregate: "aggregateAllItemData",
    destinationFieldName: params.as,
    include: "allFields",
    options: {},
  }),
  promptReference: "aggregate: combines all items into one item with a list field. params: { as: FieldName }",
});
