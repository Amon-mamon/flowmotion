import type { Value } from "@/lib/flowspec/values";
import type { JsonValue } from "@/schemas/flow";

import type { N8nParameters } from "./types";

/**
 * The n8n "resource mapper" parameter with the columns defined in the node
 * (used by googleSheets, airtable, and postgres at the pinned versions).
 */
export function defineBelowColumns(columns: readonly { name: string; value: Value }[]): N8nParameters {
  const value: Record<string, JsonValue> = {};
  const schema: JsonValue[] = [];
  for (const column of columns) {
    value[column.name] = column.value;
    schema.push({
      id: column.name,
      displayName: column.name,
      required: false,
      defaultMatch: false,
      display: true,
      type: "string",
      canBeUsedToMatch: true,
    });
  }
  return { mappingMode: "defineBelow", value, matchingColumns: [], schema };
}
