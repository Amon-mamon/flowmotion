import { defineBelowColumns } from "./mapping";
import { SQL_REFERENCE, sqlParamsSchema } from "./sql";
import { defineProfile, locator, one, unnamed } from "./types";

export const postgresProfile = defineProfile({
  name: "postgres",
  tier: 2,
  typeVersion: 2.8,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Postgres",
  paramsSchema: sqlParamsSchema,
  toParameters: (params) => {
    const base = {
      operation: params.operation,
      schema: locator("name", "public"),
      table: locator("name", params.table),
    };
    if (params.operation === "insert") {
      return { ...base, columns: defineBelowColumns(params.columns), options: {} };
    }
    return { ...base, returnAll: false, limit: params.limit, options: {} };
  },
  promptReference: `postgres: inserts a row or selects rows (credential: Postgres). ${SQL_REFERENCE}`,
});
