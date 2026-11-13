import "server-only";

import { after } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { kickLocalWorker } from "@/server/jobs/local-runner";
import { logServerError, logServerInfo } from "@/server/log";

/**
 * Worker trigger (contract section 4 "Scheduling", Phase 2 item 10).
 * Production: fire-and-forget POST to the Edge Function with the dedicated
 * WORKER_TOKEN bearer (D-30; never the service-role key) and a 2 s timeout;
 * failures are logged by code only and never fail the request. Local
 * development (`next dev`, D-26/D-27): the same state machine runs
 * in-process and claims only the triggering user's jobs.
 */

export const TRIGGER_TIMEOUT_MS = 2_000;

export interface TriggerInput {
  /** The session user whose request triggered the worker (D-27). */
  userId: string;
}

export function runsWorkerLocally(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

export async function triggerWorker(input: TriggerInput): Promise<void> {
  if (runsWorkerLocally()) {
    kickLocalWorker(input.userId);
    return;
  }
  try {
    const env = getServerEnv();
    if (env.WORKER_TOKEN === undefined) {
      logServerInfo("worker:trigger", { code: "WORKER_TOKEN_MISSING" });
      return;
    }
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/worker`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_TOKEN}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
    if (!response.ok) logServerInfo("worker:trigger", { status: response.status });
  } catch (error) {
    // A 2 s timeout is expected when the worker runs long; it keeps running.
    logServerError("worker:trigger", error);
  }
}

/** Triggers the worker after the response is sent (never blocks or fails it). */
export function scheduleWorkerTrigger(input: TriggerInput): void {
  after(() => triggerWorker(input));
}

// --- job TTL (D-29) --------------------------------------------------------------

/** `expire_stale_jobs()` (service role): fails jobs idle for 1 hour. Returns the count. */
export async function expireStaleJobs(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("expire_stale_jobs");
  if (error !== null) throw new Error(`expire_stale_jobs failed: ${error.code ?? "unknown"}`);
  return z.number().int().nonnegative().parse(data);
}

// --- poll kick (contract section 4) --------------------------------------------

export const POLL_KICK_QUEUED_AGE_MS = 15_000;
export const POLL_KICK_LOCK_AGE_MS = 120_000;
export const JOB_TTL_MS = 60 * 60 * 1000;

export const pollJobRowSchema = z.object({
  status: z.enum(["queued", "running", "done", "failed"]),
  run_after: z.string(),
  updated_at: z.string(),
  locked_at: z.string().nullable(),
});
export type PollJobRow = z.infer<typeof pollJobRowSchema>;

/**
 * True when a watched job looks stalled: `queued`, due, and untouched for
 * 15 s, or `running` with a lock older than 2 minutes.
 */
export function shouldPollKick(job: PollJobRow, nowMs: number): boolean {
  if (job.status === "queued") {
    return Date.parse(job.run_after) <= nowMs && nowMs - Date.parse(job.updated_at) > POLL_KICK_QUEUED_AGE_MS;
  }
  if (job.status === "running") {
    return job.locked_at !== null && nowMs - Date.parse(job.locked_at) > POLL_KICK_LOCK_AGE_MS;
  }
  return false;
}

/** True when an active job has not been updated for 1 hour (D-29). */
export function isJobExpired(job: PollJobRow, nowMs: number): boolean {
  return (job.status === "queued" || job.status === "running") && nowMs - Date.parse(job.updated_at) > JOB_TTL_MS;
}

export type PollKickResult = "none" | "kicked" | "expired";

/**
 * Reads the analysis's job (owner's session; the `state` column is never
 * selected or granted). An active job idle for 1 hour is expired through
 * `expire_stale_jobs()` (the caller then re-reads the analysis); a stalled
 * job gets one worker trigger for this user.
 */
export async function pollKick(userId: string, analysisId: string): Promise<PollKickResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .select("status, run_after, updated_at, locked_at")
      .eq("user_id", userId)
      .eq("kind", "analyze")
      .eq("ref_id", analysisId)
      .limit(1)
      .maybeSingle();
    if (error !== null || data === null) return "none";
    const parsed = pollJobRowSchema.safeParse(data);
    if (!parsed.success) return "none";
    const now = Date.now();
    if (isJobExpired(parsed.data, now)) {
      await expireStaleJobs();
      return "expired";
    }
    if (!shouldPollKick(parsed.data, now)) return "none";
    scheduleWorkerTrigger({ userId });
    return "kicked";
  } catch (error) {
    logServerError("worker:poll-kick", error);
    return "none";
  }
}
