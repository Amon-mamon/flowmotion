import { isAllowedNodeType } from "@/lib/n8n-catalog/allowlist";
import { hasReservedKey, scanFindsSecret } from "@/lib/security/scan-render";
import { isJsonValue } from "@/schemas/flow";

import { hasCredentialsKey, isExcludedNodeType, MAX_EXPORT_BYTES } from "./validate";

/**
 * The last check before a stored export leaves the server
 * (docs/security.md section 9, contract section 8): size, shape (no reserved
 * own keys), node types, no `credentials` key, and the secret scanner over the
 * shared scan rendering. Throws `ExportNotSafeError`; the route answers
 * `EXPORT_NOT_VALID` and logs the flow id and rule only.
 */

export type ExportSafetyRule = "shape" | "size" | "secret" | "credentials" | "type";

export class ExportNotSafeError extends Error {
  constructor(readonly rule: ExportSafetyRule) {
    // The message never carries any part of the export.
    super(`Export refused: ${rule}`);
    this.name = "ExportNotSafeError";
  }
}

const TOP_LEVEL_KEYS = ["name", "nodes", "connections", "settings"] as const;

export function assertExportSafe(workflow: unknown): void {
  // Plain JSON is needed before the size can be measured.
  if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow) || !isJsonValue(workflow)) {
    throw new ExportNotSafeError("shape");
  }
  const serialized = JSON.stringify(workflow, null, 2);
  if (new TextEncoder().encode(serialized).length > MAX_EXPORT_BYTES) throw new ExportNotSafeError("size");

  // Shape: exactly the four top-level keys, a node list of objects, no reserved key at any depth (D-49).
  if (hasReservedKey(workflow)) throw new ExportNotSafeError("shape");
  const keys = Object.keys(workflow);
  if (keys.length !== TOP_LEVEL_KEYS.length || !TOP_LEVEL_KEYS.every((key) => Object.hasOwn(workflow, key))) {
    throw new ExportNotSafeError("shape");
  }
  const nodes = (workflow as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) throw new ExportNotSafeError("shape");

  // Type (D-50): every node type is allowlisted and not excluded.
  for (const node of nodes) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) throw new ExportNotSafeError("shape");
    const type = Object.hasOwn(node, "type") ? (node as Record<string, unknown>).type : undefined;
    if (typeof type !== "string" || !isAllowedNodeType(type) || isExcludedNodeType(type)) {
      throw new ExportNotSafeError("type");
    }
  }

  if (hasCredentialsKey(workflow)) throw new ExportNotSafeError("credentials");
  if (scanFindsSecret("workflow.n8n.json", workflow)) throw new ExportNotSafeError("secret");
}
