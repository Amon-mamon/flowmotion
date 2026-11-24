import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

export const limitProfile = defineProfile({
  name: "limit",
  tier: 1,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({
    maxItems: z.number().int().min(1).max(1000),
    keep: z.enum(["first", "last"]),
  }),
  toParameters: (params) => ({
    maxItems: params.maxItems,
    keep: params.keep === "first" ? "firstItems" : "lastItems",
  }),
  promptReference: 'limit: keeps the first or last N items. params: { maxItems: integer 1..1000, keep: "first" | "last" }',
});
