import { z } from "zod";

import { defineProfile, one, unnamed } from "./types";

/** Five space-separated fields of `[0-9*\/,-]`, at most 60 characters. */
export const CRON_PATTERN = /^[0-9*/,-]+( [0-9*/,-]+){4}$/;

export const scheduleTriggerProfile = defineProfile({
  name: "scheduleTrigger",
  tier: 1,
  typeVersion: 1.4,
  isTrigger: true,
  inputs: 0,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema: z.strictObject({ cron: z.string().max(60).regex(CRON_PATTERN) }),
  toParameters: (params) => ({
    rule: { interval: [{ field: "cronExpression", expression: params.cron }] },
  }),
  promptReference:
    'scheduleTrigger: runs on a schedule. params: { cron: five space-separated cron fields using only digits and * / , - (for example "0 3 * * *") }',
});
