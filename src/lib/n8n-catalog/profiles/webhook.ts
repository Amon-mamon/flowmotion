import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const webhookParamsSchema = z.strictObject({
  path: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  method: z.enum(HTTP_METHODS),
  respond: z.enum(["immediately", "respondNode"]),
});

export const webhookProfile = defineProfile({
  name: "webhook",
  tier: 1,
  typeVersion: 2.2,
  isTrigger: true,
  inputs: 0,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: webhookParamsSchema,
  toParameters: (params) => ({
    httpMethod: params.method,
    path: params.path,
    responseMode: params.respond === "respondNode" ? "responseNode" : "onReceived",
    options: {},
  }),
  promptReference:
    'webhook: HTTP trigger; the request body is at $json.body. params: { path: lowercase letters, digits and "-" (1..64), method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", respond: "immediately" | "respondNode" } ("respondNode" requires a respondToWebhook node in the flow)',
});
