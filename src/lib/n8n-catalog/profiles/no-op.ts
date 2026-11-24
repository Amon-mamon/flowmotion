import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

export const noOpProfile = defineProfile({
  name: "noOp",
  tier: 1,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({}),
  toParameters: () => ({}),
  promptReference: "noOp: does nothing; a placeholder or join point. params: {}",
});
