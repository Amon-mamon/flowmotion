import { z } from "zod";

import { isValidText, TEXT_RULE_MESSAGE, valueSchema } from "@/lib/flowspec/values";

import { filterParameter } from "./conditions";
import { defineProfile, type N8nParameters } from "./types";

/** A literal case value: a `Text` without an expression (so it can never be evaluated). */
const caseSchema = z.union([
  z
    .string()
    .min(1)
    .max(100)
    .refine((value) => isValidText(value) && !value.includes("{{"), { message: TEXT_RULE_MESSAGE }),
  z.number().refine(Number.isFinite),
]);

export const switchProfile = defineProfile({
  name: "switch",
  tier: 1,
  typeVersion: 3.5,
  isTrigger: false,
  inputs: 1,
  outputs: (params) => params.cases.length + (params.fallback ? 1 : 0),
  outputLabels: (params) => [...params.cases.map((item) => String(item)), ...(params.fallback ? ["fallback"] : [])],
  credential: null,
  paramsSchema: z.strictObject({
    value: valueSchema,
    cases: z
      .array(caseSchema)
      .min(1)
      .max(6)
      .refine((cases) => new Set(cases.map((item) => `${typeof item}:${String(item)}`)).size === cases.length, {
        message: "Duplicate case",
      }),
    fallback: z.boolean(),
  }),
  toParameters: (params) => {
    const options: N8nParameters = params.fallback ? { fallbackOutput: "extra" } : {};
    return {
      mode: "rules",
      rules: {
        values: params.cases.map((item) => ({
          conditions: filterParameter([{ left: params.value, op: "equals", right: item }], "and"),
          renameOutput: false,
        })),
      },
      looseTypeValidation: true,
      options,
    };
  },
  promptReference:
    "switch: multi-way branch on one value; output i is cases[i], and with fallback true the last output takes everything else. params: { value: Value, cases: (string | number)[1..6] (unique), fallback: boolean }",
});
