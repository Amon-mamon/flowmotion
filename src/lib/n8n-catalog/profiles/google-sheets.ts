import { z } from "zod";

import { pairSchema, placeholderSchema, uniqueNames } from "@/lib/flowspec/values";

import { defineBelowColumns } from "./mapping";
import { defineProfile, locator, one, unnamed } from "./types";

const paramsSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("append"),
    documentId: placeholderSchema,
    sheetName: placeholderSchema,
    columns: z.array(pairSchema).min(1).max(20).refine(uniqueNames, { message: "Duplicate column" }),
  }),
  z.strictObject({
    operation: z.literal("read"),
    documentId: placeholderSchema,
    sheetName: placeholderSchema,
  }),
]);

export const googleSheetsProfile = defineProfile({
  name: "googleSheets",
  tier: 2,
  typeVersion: 4.7,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Google",
  paramsSchema,
  toParameters: (params) => {
    const base = {
      resource: "sheet",
      operation: params.operation,
      documentId: locator("id", params.documentId),
      sheetName: locator("name", params.sheetName),
    };
    if (params.operation === "append") {
      return { ...base, columns: defineBelowColumns(params.columns), options: {} };
    }
    return { ...base, options: {} };
  },
  promptReference:
    'googleSheets: appends a row or reads rows (credential: Google). params: { operation: "append", documentId: Placeholder, sheetName: Placeholder, columns: Pair[1..20] } or { operation: "read", documentId: Placeholder, sheetName: Placeholder }',
});
