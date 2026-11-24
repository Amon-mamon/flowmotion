import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

export const waitProfile = defineProfile({
  name: "wait",
  tier: 1,
  typeVersion: 1.1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({ seconds: z.number().int().min(1).max(3600) }),
  toParameters: (params) => ({ resume: "timeInterval", amount: params.seconds, unit: "seconds" }),
  promptReference: "wait: pauses the flow. params: { seconds: integer 1..3600 }",
});
