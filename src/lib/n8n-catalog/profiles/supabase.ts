import { SQL_REFERENCE, sqlParamsSchema } from "./sql";
import { asString, defineProfile, one, unnamed, type N8nParameters } from "./types";

export const supabaseProfile = defineProfile({
  name: "supabase",
  tier: 2,
  typeVersion: 1,
  isTrigger: false,
  inputs: 1,
  outputs: one,
  outputLabels: unnamed,
  credential: "Supabase",
  paramsSchema: sqlParamsSchema,
  toParameters: (params): N8nParameters => {
    if (params.operation === "insert") {
      return {
        resource: "row",
        operation: "create",
        tableId: params.table,
        dataToSend: "defineBelow",
        fieldsUi: {
          fieldValues: params.columns.map((column) => ({ fieldId: column.name, fieldValue: asString(column.value) })),
        },
      };
    }
    return {
      resource: "row",
      operation: "getAll",
      tableId: params.table,
      returnAll: false,
      limit: params.limit,
      filterType: "none",
    };
  },
  promptReference: `supabase: inserts a row or selects rows in Supabase (credential: Supabase). ${SQL_REFERENCE}`,
});
