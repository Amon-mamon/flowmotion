import { z } from "zod";

import { fieldPathSchema } from "@/lib/flowspec/values";

import { defineProfile, one, unnamed, type N8nParameters } from "./types";

export const removeDuplicatesProfile = defineProfile({
  name: "removeDuplicates",
  tier: 1,
  typeVersion: 2,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({ fields: z.array(fieldPathSchema).max(10) }),
  toParameters: (params) => {
    const parameters: N8nParameters = { operation: "removeDuplicateInputItems" };
    if (params.fields.length === 0) {
      parameters.compare = "allFields";
    } else {
      parameters.compare = "selectedFields";
      parameters.fieldsToCompare = params.fields.join(", ");
    }
    parameters.options = {};
    return parameters;
  },
  promptReference:
    "removeDuplicates: drops duplicate items. params: { fields: FieldPath[0..10] } (empty = compare all fields)",
});
