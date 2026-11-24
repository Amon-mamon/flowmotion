import { conditionsParamsSchema, filterParameter } from "./conditions";
import { defineProfile, one, unnamed } from "./types";

export const filterProfile = defineProfile({
  name: "filter",
  tier: 1,
  typeVersion: 2.4,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: conditionsParamsSchema,
  toParameters: (params) => ({
    conditions: filterParameter(params.conditions, params.combine),
    looseTypeValidation: true,
    options: {},
  }),
  promptReference:
    'filter: keeps only the items that match. params: { conditions: Condition[1..5], combine: "and" | "or" }',
});
