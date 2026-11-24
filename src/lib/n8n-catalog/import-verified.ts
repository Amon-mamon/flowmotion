import { z } from "zod";

import { N8N_VERSION } from "@/lib/n8n-catalog/version";

import committed from "../../../tests/conformance/verified.json" with { type: "json" };

/**
 * The "unverified import" flag (docs/contract.md section 8, D-9). The dev
 * import test (`npm run test:n8n-import`) writes `tests/conformance/verified.json`
 * when every golden export imports into the pinned n8n. Runtime-neutral.
 */

export const verifiedFileSchema = z.strictObject({
  n8nVersion: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});
export type VerifiedFile = z.infer<typeof verifiedFileSchema>;

/** True only when the import test has passed for the pinned n8n version. */
export function importVerified(verified: unknown = committed): boolean {
  const parsed = verifiedFileSchema.safeParse(verified);
  return parsed.success && parsed.data.n8nVersion === N8N_VERSION;
}
