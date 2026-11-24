/**
 * Server logging: ids, codes and error names only. Never request bodies,
 * tokens, model text or repository content (docs/security.md section 3).
 */

function describe(error: unknown): Record<string, string | number> {
  if (error instanceof Error) {
    const out: Record<string, string | number> = { name: error.name, message: error.message };
    const withCode = error as Error & { code?: unknown; status?: unknown };
    if (typeof withCode.code === "string") out.code = withCode.code;
    if (typeof withCode.status === "number") out.status = withCode.status;
    return out;
  }
  return { name: typeof error };
}

export function logServerError(scope: string, error: unknown): void {
  console.error(`[${scope}]`, describe(error));
}

export function logServerInfo(scope: string, fields: Record<string, string | number | boolean | null>): void {
  console.info(`[${scope}]`, fields);
}
