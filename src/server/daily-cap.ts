import "server-only";

import { ApiError } from "@/server/http";
import { logServerError } from "@/server/log";
import { hitViaDatabase, type RateLimitHit } from "@/server/rate-limit";

/**
 * Per-user daily caps (abuse protection, not billing; contract section 6,
 * security.md section 5). Counted in `rate_limits` under
 * `daily:<kind>:<user_id>:<yyyy-mm-dd>` (UTC). Not a plan limit.
 */

export type DailyCapKind = "analyze" | "generate";

export const DAILY_CAPS: Readonly<Record<DailyCapKind, number>> = { analyze: 10, generate: 30 };

const NOUN: Readonly<Record<DailyCapKind, string>> = { analyze: "analyses", generate: "generations" };

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function dailyCapKey(kind: DailyCapKind, userId: string, nowMs: number): string {
  return `daily:${kind}:${userId}:${utcDay(nowMs)}`;
}

export function dailyCapMessage(kind: DailyCapKind): string {
  return `Daily limit of ${DAILY_CAPS[kind]} ${NOUN[kind]} reached. It resets at 00:00 UTC.`;
}

/**
 * Consumes `count` units of today's cap; throws DAILY_CAP_REACHED (429) when
 * any unit is over the cap. A database failure fails closed (INTERNAL).
 */
export async function enforceDailyCap(
  userId: string,
  kind: DailyCapKind,
  count = 1,
  options: { hit?: RateLimitHit; now?: number } = {},
): Promise<void> {
  const key = dailyCapKey(kind, userId, options.now ?? Date.now());
  const hit = options.hit ?? hitViaDatabase;
  for (let i = 0; i < count; i += 1) {
    let allowed: boolean;
    try {
      allowed = await hit(key, DAILY_CAPS[kind]);
    } catch (error) {
      logServerError("daily-cap", error);
      throw new ApiError("INTERNAL");
    }
    if (!allowed) throw new ApiError("DAILY_CAP_REACHED", dailyCapMessage(kind));
  }
}
