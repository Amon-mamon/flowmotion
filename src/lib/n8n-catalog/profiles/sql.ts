import { z } from "zod";

import { identSchema, valueSchema } from "@/lib/flowspec/values";

/** Shared by `postgres` and `supabase`: identifiers only, never raw SQL. */
export const sqlParamsSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("insert"),
    table: identSchema,
    columns: z
      .array(z.strictObject({ name: identSchema, value: valueSchema }))
      .min(1)
      .max(20)
      .refine((columns) => new Set(columns.map((column) => column.name)).size === columns.length, {
        message: "Duplicate column",
      }),
  }),
  z.strictObject({
    operation: z.literal("select"),
    table: identSchema,
    limit: z.number().int().min(1).max(100),
  }),
]);
export type SqlParams = z.infer<typeof sqlParamsSchema>;

export const SQL_REFERENCE =
  'params: { operation: "insert", table: Ident, columns: { name: Ident, value: Value }[1..20] } or { operation: "select", table: Ident, limit: integer 1..100 }. Never raw SQL.';
