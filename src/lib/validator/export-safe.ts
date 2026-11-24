import { scan } from "@/lib/security/secret-scanner";
import { isJsonValue } from "@/schemas/flow";

import { hasCredentialsKey, MAX_EXPORT_BYTES, renderForScan } from "./validate";

/**
 * The last check before a stored export leaves the server
 * (docs/security.md section 9): the secret scanner once more, no
 * `credentials` key, and the 256 KB size limit. Throws `ExportNotSafeError`;
 * the route answers `EXPORT_NOT_VALID` and logs the flow id and rule only.
 */

export type ExportSafetyRule = "shape" | "size" | "secret" | "credentials";

export class ExportNotSafeError extends Error {
  constructor(readonly rule: ExportSafetyRule) {
    // The message never carries any part of the export.
    super(`Export refused: ${rule}`);
    this.name = "ExportNotSafeError";
  }
}

export function assertExportSafe(workflow: unknown): void {
  if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow) || !isJsonValue(workflow)) {
    throw new ExportNotSafeError("shape");
  }
  const serialized = JSON.stringify(workflow, null, 2);
  if (new TextEncoder().encode(serialized).length > MAX_EXPORT_BYTES) throw new ExportNotSafeError("size");
  if (hasCredentialsKey(workflow)) throw new ExportNotSafeError("credentials");
  if (scan("workflow.n8n.json", renderForScan(workflow)).findings.length > 0) throw new ExportNotSafeError("secret");
}
