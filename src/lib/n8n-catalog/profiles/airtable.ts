import { z } from "zod";

import { pairSchema, placeholderSchema, uniqueNames } from "@/lib/flowspec/values";

import { defineBelowColumns } from "./mapping";
import { defineProfile, locator, one, unnamed } from "./types";

export const airtableProfile = defineProfile({
  name: "airtable",
  tier: 2,
  typeVersion: 2.2,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Airtable",
  paramsSchema: z.strictObject({
    baseId: placeholderSchema,
    table: placeholderSchema,
    fields: z.array(pairSchema).min(1).max(20).refine(uniqueNames, { message: "Duplicate field" }),
  }),
  toParameters: (params) => ({
    resource: "record",
    operation: "create",
    base: locator("id", params.baseId),
    table: locator("id", params.table),
    columns: defineBelowColumns(params.fields),
    options: {},
  }),
  promptReference:
    "airtable: creates a record (credential: Airtable). params: { baseId: Placeholder, table: Placeholder, fields: Pair[1..20] }",
});
