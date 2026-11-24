import { z } from "zod";

import { conditionSchema, type Condition } from "@/lib/flowspec/values";
import type { JsonValue } from "@/schemas/flow";

import { stableId, type N8nParameters } from "./types";

/**
 * Shared by `if`, `filter`, and `switch`: FlowSpec conditions to the n8n
 * "filter" parameter (conditions version 4 at if / filter 2.4 and switch 3.5).
 * Type validation is loose because expression results are not typed.
 */

export const FILTER_VERSION = 4;

export const conditionsParamsSchema = z.strictObject({
  conditions: z.array(conditionSchema).min(1).max(5),
  combine: z.enum(["and", "or"]),
});
export type ConditionsParams = z.infer<typeof conditionsParamsSchema>;

function operatorFor(condition: Condition): N8nParameters {
  switch (condition.op) {
    case "equals":
    case "notEquals": {
      const type =
        typeof condition.right === "number" ? "number" : typeof condition.right === "boolean" ? "boolean" : "string";
      return { type, operation: condition.op };
    }
    case "contains":
    case "notContains":
      return { type: "string", operation: condition.op };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { type: "number", operation: condition.op };
    case "exists":
    case "notExists":
      return { type: "string", operation: condition.op, singleValue: true };
    case "isTrue":
      return { type: "boolean", operation: "true", singleValue: true };
    case "isFalse":
      return { type: "boolean", operation: "false", singleValue: true };
  }
}

export function filterParameter(conditions: readonly Condition[], combine: "and" | "or"): N8nParameters {
  const list: JsonValue[] = conditions.map((condition, index) => ({
    id: stableId(`condition:${index}`),
    leftValue: condition.left,
    rightValue: condition.right ?? "",
    operator: operatorFor(condition),
  }));
  return {
    options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: FILTER_VERSION },
    conditions: list,
    combinator: combine,
  };
}

export const CONDITION_REFERENCE =
  'Condition = { left: Value, op: "equals" | "notEquals" | "contains" | "notContains" | "gt" | "gte" | "lt" | "lte" | "exists" | "notExists" | "isTrue" | "isFalse", right?: Value } (right is required except for exists, notExists, isTrue, isFalse)';
