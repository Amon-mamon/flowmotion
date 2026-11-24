import { conditionsParamsSchema, filterParameter } from "./conditions";
import { defineProfile } from "./types";

export const ifProfile = defineProfile({
  name: "if",
  tier: 1,
  typeVersion: 2.4,
  isTrigger: false,
  inputs: 1,
  outputs: () => 2,
  outputLabels: () => ["true", "false"],
  credential: null,
  paramsSchema: conditionsParamsSchema,
  toParameters: (params) => ({
    conditions: filterParameter(params.conditions, params.combine),
    looseTypeValidation: true,
    options: {},
  }),
  promptReference:
    'if: two-way branch; edges use output 0 for true and output 1 for false. params: { conditions: Condition[1..5], combine: "and" | "or" }',
});
