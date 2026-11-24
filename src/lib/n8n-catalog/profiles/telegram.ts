import { z } from "zod";

import { placeholderSchema, textSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const telegramProfile = defineProfile({
  name: "telegram",
  tier: 2,
  typeVersion: 1.2,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Telegram",
  paramsSchema: z.strictObject({ chatId: placeholderSchema, text: textSchema }),
  toParameters: (params) => ({
    resource: "message",
    operation: "sendMessage",
    chatId: params.chatId,
    text: params.text,
    additionalFields: {},
  }),
  promptReference:
    "telegram: sends a message to a chat (credential: Telegram). params: { chatId: Placeholder, text: Text }",
});
