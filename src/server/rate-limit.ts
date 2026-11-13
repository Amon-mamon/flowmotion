import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, getClientIp } from "@/server/http";
import { logServerError } from "@/server/log";

/**
 * Postgres-based fixed-window rate limiter (docs/security.md section 5).
 * Keys: `rl:<route>:<subject>:<window>` where window is the minute start
 * (epoch seconds). The `rate_limit_hit` function increments atomically and
 * returns whether the caller is still within the limit.
 */

export const WINDOW_MS = 60_000;

/** Defaults until Phase 5 tunes them (security.md section 5). */
export const RATE_LIMITS = {
  /** Per user on all /api/* routes. */
  api: 120,
  /** Per user on analyze, generate, test, export. */
  heavy: 10,
  /** Per IP on /api/auth/*, /api/github/install and the installations callback. */
  auth: 20,
  /** Per IP on the webhook. */
  webhook: 60,
} as const;

export type RateLimitHit = (key: string, limit: number) => Promise<boolean>;

export interface RateLimitInput {
  /** Short route name, e.g. "projects.create". */
  route: string;
  /** User id or client IP. */
  subject: string;
  limit: number;
  /** Injectable for tests; defaults to the `rate_limit_hit` RPC. */
  hit?: RateLimitHit;
  /** Epoch ms, for tests. */
  now?: number;
}

export function windowStart(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

export function rateLimitKey(route: string, subject: string, nowMs: number): string {
  return `rl:${route}:${subject}:${Math.floor(windowStart(nowMs) / 1000)}`;
}

/** Seconds until the current window ends. */
export function retryAfterSeconds(nowMs: number): number {
  return Math.max(1, Math.ceil((windowStart(nowMs) + WINDOW_MS - nowMs) / 1000));
}

export async function hitViaDatabase(key: string, limit: number): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("rate_limit_hit", { p_key: key, p_limit: limit });
  if (error !== null) throw new Error(`rate_limit_hit failed: ${error.code ?? "unknown"}`);
  if (typeof data !== "boolean") throw new Error("rate_limit_hit returned a non-boolean");
  return data;
}

/** Per-user default limit for /api/* routes. */
export async function enforceUserLimit(route: string, userId: string, limit: number = RATE_LIMITS.api) {
  await enforceRateLimit({ route, subject: `u:${userId}`, limit });
}

/** Per-IP limit for sessionless or browser-navigated routes. */
export async function enforceIpLimit(route: string, request: Request, limit: number) {
  await enforceRateLimit({ route, subject: `ip:${getClientIp(request)}`, limit });
}

/**
 * Throws `RATE_LIMITED` 429 when the subject exceeds `limit` hits in the
 * current minute. A database failure fails closed (INTERNAL), never open.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<void> {
  const now = input.now ?? Date.now();
  const key = rateLimitKey(input.route, input.subject, now);
  const hit = input.hit ?? hitViaDatabase;
  let allowed: boolean;
  try {
    allowed = await hit(key, input.limit);
  } catch (error) {
    logServerError("rate-limit", error);
    throw new ApiError("INTERNAL");
  }
  if (!allowed) {
    throw new ApiError(
      "RATE_LIMITED",
      `Too many requests. Please try again in ${retryAfterSeconds(now)} seconds.`,
    );
  }
}
