import { z } from "zod";

import { placeholderSchema, textSchema } from "@/lib/flowspec/values";

import { defineProfile, locator, one, unnamed } from "./types";

export const notionProfile = defineProfile({
  name: "notion",
  tier: 2,
  typeVersion: 3,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Notion",
  paramsSchema: z.strictObject({ databaseId: placeholderSchema, title: textSchema }),
  // At the pinned version a database page is created in a "data source".
  toParameters: (params) => ({
    resource: "databasePage",
    operation: "create",
    dataSourceId: locator("id", params.databaseId),
    title: params.title,
    options: {},
  }),
  promptReference:
    "notion: creates a page in a database (credential: Notion). params: { databaseId: Placeholder, title: Text }",
});
