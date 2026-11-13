import { timingSafeEqualString } from "@/lib/security/timing-safe";

/**
 * Worker endpoint auth (D-30, S2-6): `Authorization: Bearer <WORKER_TOKEN>`.
 * Fails closed: a missing or short (< 64 chars) configured token rejects
 * every request. Constant-time compare. The service-role key is never a
 * bearer.
 */
export const MIN_WORKER_TOKEN_LENGTH = 64;

export function isWorkerTokenConfigured(token: string | undefined): token is string {
  return token !== undefined && token.trim().length >= MIN_WORKER_TOKEN_LENGTH;
}

export function isWorkerRequestAuthorized(authorization: string | null, token: string | undefined): boolean {
  if (!isWorkerTokenConfigured(token)) return false;
  const header = authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqualString(bearer, token.trim());
}
