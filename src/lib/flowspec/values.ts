import { z } from "zod";

import { containsSchemeSeparator, parseTemplate } from "@/lib/flowspec/expression";

/**
 * Value types used by the node profiles (docs/contract.md section 7, D-39).
 * Pure and runtime-neutral.
 */

export const MAX_TEXT_LENGTH = 2000;
export const PLACEHOLDER_PATTERN = /^YOUR_[A-Z0-9_]{2,40}$/;
export const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const IDENT_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Every Zod issue raised by a text rule carries this message, so `checkFlowSpec` reports it as F8. */
export const TEXT_RULE_MESSAGE = "Text rule (F8)";

/** Control characters other than the line feed. */
const TEXT_CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** True when `value` follows every rule of a `Text` (length is checked by the schema). */
export function isValidText(value: string): boolean {
  if (value.startsWith("=")) return false;
  if (TEXT_CONTROL_CHARS.test(value)) return false;
  // D-51 / S3a-6 / S3aR-2: no link or host of any scheme, in any form
  // (`://`, `:\\`, `:/\\`, or rebuilt around an expression). Validator rule 8 agrees.
  if (value.includes("://") || containsSchemeSeparator(value)) return false;
  return parseTemplate(value).ok;
}

function text(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine(isValidText, { message: TEXT_RULE_MESSAGE });
}

/**
 * `Text`: at most 2,000 characters, never starts with `=`, no control
 * characters except `\n`, and every `{{ … }}` is a valid expression of the
 * subset. Text without `{{` is a literal.
 */
export const textSchema = text(0, MAX_TEXT_LENGTH);
export type Text = z.infer<typeof textSchema>;

/** A `Text` with its own length bounds. */
export function boundedText(min: number, max: number) {
  return text(min, Math.min(max, MAX_TEXT_LENGTH));
}

/** `Value`: `Text | number | boolean`. */
export const valueSchema = z.union([textSchema, z.number().refine(Number.isFinite), z.boolean()]);
export type Value = z.infer<typeof valueSchema>;

/** `Placeholder`: every external destination is one of these, never a literal (D-39). */
export const placeholderSchema = z.string().regex(PLACEHOLDER_PATTERN);
export type Placeholder = z.infer<typeof placeholderSchema>;

/** Refused as a `FieldName`, any `FieldPath` part, and an `Ident` (D-49, exact, case-sensitive). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const notReserved = (value: string): boolean => !RESERVED_NAMES.has(value);

export const fieldNameSchema = z
  .string()
  .regex(FIELD_NAME_PATTERN)
  .refine(notReserved, { message: "Reserved name" });
export type FieldName = z.infer<typeof fieldNameSchema>;

/** `FieldPath`: 1..6 `FieldName`s joined by `.`. */
export const fieldPathSchema = z
  .string()
  .max(400)
  .refine((value) => {
    const parts = value.split(".");
    return (
      parts.length >= 1 &&
      parts.length <= 6 &&
      parts.every((part) => FIELD_NAME_PATTERN.test(part) && notReserved(part))
    );
  });
export type FieldPath = z.infer<typeof fieldPathSchema>;

/** `Ident`: SQL table or column name. */
export const identSchema = z
  .string()
  .regex(IDENT_PATTERN)
  .refine(notReserved, { message: "Reserved name" });
export type Ident = z.infer<typeof identSchema>;

export const pairSchema = z.strictObject({ name: fieldNameSchema, value: valueSchema });
export type Pair = z.infer<typeof pairSchema>;

export const CONDITION_OPS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "notExists",
  "isTrue",
  "isFalse",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** Operators that take no right-hand value. */
export const UNARY_OPS: ReadonlySet<ConditionOp> = new Set(["exists", "notExists", "isTrue", "isFalse"]);

/** `Condition`: `right` is required except for the four unary operators. */
export const conditionSchema = z
  .strictObject({
    left: valueSchema,
    op: z.enum(CONDITION_OPS),
    right: valueSchema.optional(),
  })
  .refine((condition) => UNARY_OPS.has(condition.op) || condition.right !== undefined, {
    message: "right is required for this operator",
  });
export type Condition = z.infer<typeof conditionSchema>;

/** Unique `name`s in a list of pairs or columns. */
export function uniqueNames(items: readonly { name: string }[]): boolean {
  return new Set(items.map((item) => item.name)).size === items.length;
}
