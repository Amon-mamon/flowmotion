import { z } from "zod";

import { defineProfile } from "./types";

export const splitInBatchesProfile = defineProfile({
  name: "splitInBatches",
  tier: 1,
  typeVersion: 3,
  isTrigger: false,
  inputs: 1,
  outputs: () => 2,
  outputLabels: () => ["done", "loop"],
  credential: null,
  paramsSchema: z.strictObject({ batchSize: z.number().int().min(1).max(100) }),
  toParameters: (params) => ({ batchSize: params.batchSize, options: {} }),
  promptReference:
    "splitInBatches: loops over items in batches; output 1 (loop) goes to the loop body, whose last node connects back into this node; output 0 (done) continues after the loop. params: { batchSize: integer 1..100 }",
});
