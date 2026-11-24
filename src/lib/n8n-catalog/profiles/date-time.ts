import { z } from "zod";

import { fieldNameSchema, valueSchema } from "@/lib/flowspec/values";

import { asString, defineProfile, one, unnamed, type N8nParameters } from "./types";

const FORMATS = ["yyyy-MM-dd", "yyyy-MM-dd HH:mm", "iso"] as const;

const paramsSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("now"), as: fieldNameSchema }),
  z.strictObject({
    operation: z.literal("format"),
    value: valueSchema,
    format: z.enum(FORMATS),
    as: fieldNameSchema,
  }),
]);

export const dateTimeProfile = defineProfile({
  name: "dateTime",
  tier: 1,
  typeVersion: 2,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: null,
  paramsSchema,
  toParameters: (params) => {
    if (params.operation === "now") {
      return { operation: "getCurrentDate", includeTime: true, outputFieldName: params.as, options: {} };
    }
    const parameters: N8nParameters = { operation: "formatDate", date: asString(params.value) };
    if (params.format === "yyyy-MM-dd") {
      parameters.format = "yyyy-MM-dd";
    } else {
      parameters.format = "custom";
      parameters.customFormat = params.format === "iso" ? "yyyy-MM-dd'T'HH:mm:ssZZ" : "yyyy-MM-dd HH:mm";
    }
    parameters.outputFieldName = params.as;
    parameters.options = {};
    return parameters;
  },
  promptReference:
    'dateTime: adds a date field. params: { operation: "now", as: FieldName } or { operation: "format", value: Value, format: "yyyy-MM-dd" | "yyyy-MM-dd HH:mm" | "iso", as: FieldName }',
});
