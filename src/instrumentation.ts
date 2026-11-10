/**
 * Startup validation (docs/contract.md section 10): the server env is parsed
 * once when the Node.js runtime boots, so `next start` and `next dev` fail
 * fast with the list of missing names. Skipped during `next build` and in
 * tests, which must not need real values. Callers still use the lazy, cached
 * `getServerEnv()`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "test") return;

  const { getServerEnv } = await import("@/lib/env.server");
  getServerEnv();
}
