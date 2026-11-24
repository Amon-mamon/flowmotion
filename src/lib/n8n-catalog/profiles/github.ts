import { z } from "zod";

import { placeholderSchema, textSchema } from "@/lib/flowspec/values";

import { defineProfile, locator, one, unnamed } from "./types";

export const githubProfile = defineProfile({
  name: "github",
  tier: 2,
  typeVersion: 1.1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "GitHub",
  paramsSchema: z.strictObject({
    owner: placeholderSchema,
    repo: placeholderSchema,
    title: textSchema,
    body: textSchema,
  }),
  toParameters: (params) => ({
    resource: "issue",
    operation: "create",
    owner: locator("name", params.owner),
    repository: locator("name", params.repo),
    title: params.title,
    body: params.body,
    labels: [],
    assignees: [],
  }),
  promptReference:
    "github: creates an issue (credential: GitHub). params: { owner: Placeholder, repo: Placeholder, title: Text, body: Text }",
});
