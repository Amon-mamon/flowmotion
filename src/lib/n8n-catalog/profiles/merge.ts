import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

export const mergeProfile = defineProfile({
  name: "merge",
  tier: 1,
  typeVersion: 3.2,
  isTrigger: false,
  inputs: 2,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({ mode: z.literal("append") }),
  toParameters: (params) => ({ mode: params.mode, numberInputs: 2 }),
  promptReference:
    'merge: combines two branches into one list; it has two inputs, so the edges into it set input 0 and input 1. params: { mode: "append" }',
});
