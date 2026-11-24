import { z } from "zod";

import { fieldPathSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const sortProfile = defineProfile({
  name: "sort",
  tier: 1,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({
    by: z
      .array(z.strictObject({ field: fieldPathSchema, order: z.enum(["asc", "desc"]) }))
      .min(1)
      .max(3),
  }),
  toParameters: (params) => ({
    type: "simple",
    sortFieldsUi: {
      sortField: params.by.map((item) => ({
        fieldName: item.field,
        order: item.order === "asc" ? "ascending" : "descending",
      })),
    },
    options: {},
  }),
  promptReference: 'sort: sorts items. params: { by: { field: FieldPath, order: "asc" | "desc" }[1..3] }',
});
