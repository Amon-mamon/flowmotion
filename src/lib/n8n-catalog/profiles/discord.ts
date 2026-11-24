import { z } from "zod";

import { textSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const discordProfile = defineProfile({
  name: "discord",
  tier: 2,
  typeVersion: 2,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Discord",
  paramsSchema: z.strictObject({ text: textSchema }),
  toParameters: (params) => ({
    authentication: "webhook",
    operation: "sendLegacy",
    content: params.text,
    options: {},
  }),
  promptReference:
    "discord: posts a message through the Discord webhook credential (credential: Discord). params: { text: Text }",
});
