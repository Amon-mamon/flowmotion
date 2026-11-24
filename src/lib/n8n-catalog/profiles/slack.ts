import { z } from "zod";

import { placeholderSchema, textSchema } from "@/lib/flowspec/values";

import { defineProfile, locator, one, unnamed } from "./types";

export const slackProfile = defineProfile({
  name: "slack",
  tier: 2,
  typeVersion: 2.7,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Slack",
  paramsSchema: z.strictObject({ channel: placeholderSchema, text: textSchema }),
  toParameters: (params) => ({
    resource: "message",
    operation: "post",
    select: "channel",
    channelId: locator("id", params.channel),
    messageType: "text",
    text: params.text,
    otherOptions: {},
  }),
  promptReference:
    "slack: posts a message to a channel (credential: Slack). params: { channel: Placeholder, text: Text }",
});
