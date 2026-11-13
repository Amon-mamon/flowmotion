// @vitest-environment node
/** Worker trigger (prod Edge Function vs local in-process runner), poll kick rule, daily caps. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  after: vi.fn((callback: () => unknown) => {
    void callback();
  }),
  kickLocal: vi.fn(),
  jobRow: null as Record<string, unknown> | null,
  expireRpc: vi.fn(async () => ({ data: 1, error: null })),
  workerToken: "w".repeat(64) as string | undefined,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: m.after,
}));
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    WORKER_TOKEN: m.workerToken,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.expireRpc }) }));
vi.mock("@/server/jobs/local-runner", () => ({ kickLocalWorker: m.kickLocal }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: m.jobRow, error: null }),
      };
      return query;
    },
  }),
}));

import { dailyCapKey, dailyCapMessage, enforceDailyCap } from "@/server/daily-cap";
import { ApiError } from "@/server/http";
import { isJobExpired, pollKick, runsWorkerLocally, shouldPollKick, triggerWorker } from "@/server/jobs/trigger";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("triggerWorker", () => {
  it("runs locally (in-process) outside production and never calls the network", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await triggerWorker({ userId: "user-1" });
    expect(m.kickLocal).toHaveBeenCalledWith("user-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("production POSTs the Edge Function with the WORKER_TOKEN bearer (never the service-role key) and a timeout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    m.workerToken = "w".repeat(64);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await triggerWorker({ userId: "user-1" });
    expect(m.kickLocal).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/functions/v1/worker");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${"w".repeat(64)}`);
    expect(JSON.stringify(init.headers)).not.toContain("service-role-test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("production trigger failures never throw and never log the key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    await expect(triggerWorker({ userId: "u" })).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(triggerWorker({ userId: "u" })).resolves.toBeUndefined();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("service-role-test-key");
  });

  it("production without WORKER_TOKEN does not call the worker", async () => {
    vi.stubEnv("NODE_ENV", "production");
    m.workerToken = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await triggerWorker({ userId: "u" });
    expect(fetchMock).not.toHaveBeenCalled();
    m.workerToken = "w".repeat(64);
  });

  it("runsWorkerLocally", () => {
    expect(runsWorkerLocally("development")).toBe(true);
    expect(runsWorkerLocally("test")).toBe(true);
    expect(runsWorkerLocally(undefined)).toBe(true);
    expect(runsWorkerLocally("production")).toBe(false);
  });
});

describe("poll kick rule (contract section 4)", () => {
  const job = (overrides: Record<string, unknown>) => ({
    status: "queued" as const,
    run_after: iso(-60_000),
    updated_at: iso(-60_000),
    locked_at: null,
    ...overrides,
  });

  it("queued, due, untouched for > 15 s → kick", () => {
    expect(shouldPollKick(job({}), NOW)).toBe(true);
  });
  it("queued but recently updated or not yet due → no kick", () => {
    expect(shouldPollKick(job({ updated_at: iso(-5_000) }), NOW)).toBe(false);
    expect(shouldPollKick(job({ run_after: iso(30_000) }), NOW)).toBe(false);
  });
  it("running with a lock older than 2 minutes → kick; fresh lock → no kick", () => {
    expect(shouldPollKick(job({ status: "running", locked_at: iso(-121_000) }), NOW)).toBe(true);
    expect(shouldPollKick(job({ status: "running", locked_at: iso(-30_000) }), NOW)).toBe(false);
  });
  it("finished jobs are never kicked", () => {
    expect(shouldPollKick(job({ status: "done" }), NOW)).toBe(false);
    expect(shouldPollKick(job({ status: "failed" }), NOW)).toBe(false);
  });

  it("pollKick schedules one trigger for a stalled job (local runner in dev)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    m.jobRow = { status: "queued", run_after: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString(), locked_at: null };
    expect(await pollKick("u", "a")).toBe("kicked");
    expect(m.after).toHaveBeenCalledTimes(1);
    expect(m.kickLocal).toHaveBeenCalledWith("u");
    expect(m.expireRpc).not.toHaveBeenCalled();
  });

  it("pollKick does nothing for a fresh job or no job", async () => {
    m.jobRow = { status: "queued", run_after: new Date().toISOString(), updated_at: new Date().toISOString(), locked_at: null };
    expect(await pollKick("u", "a")).toBe("none");
    m.jobRow = null;
    expect(await pollKick("u", "a")).toBe("none");
    expect(m.after).not.toHaveBeenCalled();
  });
});

describe("job TTL (D-29) in the poll kick", () => {
  it("an active job idle for over 1 hour is expired via expire_stale_jobs, no trigger", async () => {
    const old = new Date(Date.now() - 61 * 60_000).toISOString();
    m.jobRow = { status: "queued", run_after: old, updated_at: old, locked_at: null };
    expect(await pollKick("u", "a")).toBe("expired");
    expect(m.expireRpc).toHaveBeenCalledWith("expire_stale_jobs");
    expect(m.after).not.toHaveBeenCalled();
  });

  it("isJobExpired only for active jobs", () => {
    const old = iso(-61 * 60_000);
    expect(isJobExpired({ status: "running", run_after: old, updated_at: old, locked_at: old }, NOW)).toBe(true);
    expect(isJobExpired({ status: "done", run_after: old, updated_at: old, locked_at: null }, NOW)).toBe(false);
    expect(isJobExpired({ status: "queued", run_after: old, updated_at: iso(-59 * 60_000), locked_at: null }, NOW)).toBe(false);
  });
});

describe("daily caps", () => {
  it("UTC day key and message", () => {
    expect(dailyCapKey("analyze", "u1", Date.parse("2026-11-13T23:59:59Z"))).toBe("daily:analyze:u1:2026-11-13");
    expect(dailyCapKey("generate", "u1", Date.parse("2026-11-14T00:00:00Z"))).toBe("daily:generate:u1:2026-11-14");
    expect(dailyCapMessage("analyze")).toBe("Daily limit of 10 analyses reached. It resets at 00:00 UTC.");
    expect(dailyCapMessage("generate")).toBe("Daily limit of 30 generations reached. It resets at 00:00 UTC.");
  });

  it("passes under the cap and throws DAILY_CAP_REACHED 429 over it", async () => {
    let count = 0;
    const hit = vi.fn(async (_key: string, limit: number) => {
      count += 1;
      return count <= limit;
    });
    for (let i = 0; i < 10; i += 1) await enforceDailyCap("u1", "analyze", 1, { hit });
    const error = await enforceDailyCap("u1", "analyze", 1, { hit }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("DAILY_CAP_REACHED");
    expect((error as ApiError).status).toBe(429);
    expect(hit).toHaveBeenLastCalledWith(expect.stringMatching(/^daily:analyze:u1:/), 10);
  });

  it("counts each unit for generate", async () => {
    const hit = vi.fn(async () => true);
    await enforceDailyCap("u1", "generate", 3, { hit });
    expect(hit).toHaveBeenCalledTimes(3);
    expect(hit).toHaveBeenCalledWith(expect.stringMatching(/^daily:generate:/), 30);
  });

  it("a database failure fails closed (INTERNAL)", async () => {
    const error = await enforceDailyCap("u1", "analyze", 1, { hit: async () => { throw new Error("db"); } }).catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("INTERNAL");
  });
});
