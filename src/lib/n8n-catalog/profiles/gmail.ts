import { z } from "zod";

import { placeholderSchema, textSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const gmailProfile = defineProfile({
  name: "gmail",
  tier: 2,
  typeVersion: 2.2,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Google",
  paramsSchema: z.strictObject({ to: placeholderSchema, subject: textSchema, message: textSchema }),
  toParameters: (params) => ({
    resource: "message",
    operation: "send",
    sendTo: params.to,
    subject: params.subject,
    emailType: "text",
    message: params.message,
    options: {},
  }),
  promptReference:
    "gmail: sends an email through Gmail (credential: Google). params: { to: Placeholder, subject: Text, message: Text }",
});
