import { z } from "zod";

import { placeholderSchema, textSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed } from "./types";

export const emailSendProfile = defineProfile({
  name: "emailSend",
  tier: 2,
  typeVersion: 2.1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "SMTP",
  paramsSchema: z.strictObject({
    from: placeholderSchema,
    to: placeholderSchema,
    subject: textSchema,
    text: textSchema,
  }),
  toParameters: (params) => ({
    operation: "send",
    fromEmail: params.from,
    toEmail: params.to,
    subject: params.subject,
    emailFormat: "text",
    text: params.text,
    options: {},
  }),
  promptReference:
    "emailSend: sends an email over SMTP (credential: SMTP). params: { from: Placeholder, to: Placeholder, subject: Text, text: Text }",
});
