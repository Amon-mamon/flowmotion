// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
  }),
}));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

import { ApiError } from "@/server/http";
import {
  RATE_LIMITS,
  WINDOW_MS,
  enforceIpLimit,
  enforceRateLimit,
  enforceUserLimit,
  rateLimitKey,
  retryAfterSeconds,
  windowStart,
} from "@/server/rate-limit";

describe("rate limit keys", () => {
  it("uses fixed one-minute windows in the key", () => {
    const t0 = Date.UTC(2026, 10, 10, 12, 34, 56, 789);
    const start = windowStart(t0);
    expect(start % WINDOW_MS).toBe(0);
    expect(rateLimitKey("projects.list", "u:abc", t0)).toBe(
      `rl:projects.list:u:abc:${Math.floor(start / 1000)}`,
    );
    // Same minute → same key; next minute → different key.
    expect(rateLimitKey("r", "s", t0 + 1000)).toBe(rateLimitKey("r", "s", t0));
    expect(rateLimitKey("r", "s", t0 + WINDOW_MS)).not.toBe(rateLimitKey("r", "s", t0));
  });

  it("retryAfterSeconds counts to the end of the window", () => {
    const start = windowStart(Date.UTC(2026, 10, 10, 12, 34, 0));
    expect(retryAfterSeconds(start)).toBe(60);
    expect(retryAfterSeconds(start + 59_500)).toBe(1);
  });

  it("defaults match security.md section 5", () => {
    expect(RATE_LIMITS).toEqual({ api: 120, heavy: 10, auth: 20, webhook: 60 });
  });
});

describe("enforceRateLimit with a fake rate_limit_hit", () => {
  it("allows while the function returns true and passes key + limit", async () => {
    const hit = vi.fn(async () => true);
    await expect(
      enforceRateLimit({ route: "r", subject: "u:1", limit: 5, hit, now: 60_000 }),
    ).resolves.toBeUndefined();
    expect(hit).toHaveBeenCalledWith("rl:r:u:1:60", 5);
  });

  it("throws RATE_LIMITED 429 when the function returns false", async () => {
    const hit = vi.fn(async () => false);
    await expect(
      enforceRateLimit({ route: "r", subject: "u:1", limit: 5, hit, now: 60_000 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("counts: the (limit + 1)th call in a window is refused", async () => {
    const counts = new Map<string, number>();
    const hit = async (key: string, limit: number) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n <= limit;
    };
    const now = 120_000;
    for (let i = 0; i < 3; i += 1) {
      await enforceRateLimit({ route: "r", subject: "s", limit: 3, hit, now });
    }
    await expect(enforceRateLimit({ route: "r", subject: "s", limit: 3, hit, now })).rejects.toThrow(
      ApiError,
    );
    // A new window starts fresh.
    await expect(
      enforceRateLimit({ route: "r", subject: "s", limit: 3, hit, now: now + WINDOW_MS }),
    ).resolves.toBeUndefined();
  });

  it("fails closed with INTERNAL when the function throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hit = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(
      enforceRateLimit({ route: "r", subject: "u:1", limit: 5, hit }),
    ).rejects.toMatchObject({ code: "INTERNAL", status: 500 });
    spy.mockRestore();
  });
});

describe("database-backed hit", () => {
  it("calls rate_limit_hit with p_key and p_limit and honours a false result", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(enforceUserLimit("profile.get", "user-1")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "rate_limit_hit",
      expect.objectContaining({ p_limit: RATE_LIMITS.api, p_key: expect.stringMatching(/^rl:profile\.get:u:user-1:\d+$/) }),
    );

    rpc.mockResolvedValueOnce({ data: false, error: null });
    const request = new Request("https://x/api/github/webhook", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    await expect(enforceIpLimit("github.webhook", request, RATE_LIMITS.webhook)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "rate_limit_hit",
      expect.objectContaining({ p_limit: 60, p_key: expect.stringMatching(/^rl:github\.webhook:ip:9\.9\.9\.9:\d+$/) }),
    );
  });

  it("fails closed on an RPC error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42883" } });
    await expect(enforceUserLimit("x", "u")).rejects.toMatchObject({ code: "INTERNAL" });
    spy.mockRestore();
  });
});
