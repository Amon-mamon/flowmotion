import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

export const manualTriggerProfile = defineProfile({
  name: "manualTrigger",
  tier: 1,
  typeVersion: 1,
  isTrigger: true,
  inputs: 0,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({}),
  toParameters: () => ({}),
  promptReference: "manualTrigger: starts the flow by hand. params: {}",
});
