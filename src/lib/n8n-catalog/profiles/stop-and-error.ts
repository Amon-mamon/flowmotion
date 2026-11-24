import { z } from "zod";

import { boundedText } from "@/lib/flowspec/values";

import { defineProfile } from "./types";

export const stopAndErrorProfile = defineProfile({
  name: "stopAndError",
  tier: 1,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  // The pinned n8n defines no output for this node: nothing may follow it.
  outputs: () => 0,
  outputLabels: () => [],
  credential: null,
  paramsSchema: z.strictObject({ message: boundedText(1, 200) }),
  toParameters: (params) => ({ errorType: "errorMessage", errorMessage: params.message }),
  promptReference:
    "stopAndError: fails the flow on purpose with a message; it has no output, so no edge may leave it. params: { message: Text (1..200 chars) }",
});
