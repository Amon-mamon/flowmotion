import "server-only";

import { getServerEnv } from "@/lib/env.server";
import { createModelFromEnv, createWorkerGitHub } from "@/lib/jobs/runtime";
import { createSupabaseWorkerDb } from "@/lib/jobs/supabase-db";
import type { WorkerDeps } from "@/lib/jobs/types";
import { runOnce } from "@/lib/jobs/worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError, logServerInfo } from "@/server/log";

/**
 * Local development worker (D-26, amended by D-27): under `next dev` the
 * worker trigger runs the same `runOnce` state machine in this Node process
 * instead of calling the Edge Function, so an analysis runs to completion
 * with nothing deployed. It claims ONLY the jobs of the user whose request
 * triggered it (`claim_job(p_worker_id, p_user_id)`), so a laptop pointed at
 * a shared database never processes other users' analyses. Production
 * always uses the Edge Function.
 *
 * One loop per user per process (shared through globalThis because route
 * bundles may load this module more than once); a kick during a loop asks
 * for one more pass. claim_job() uses FOR UPDATE SKIP LOCKED and job updates
 * check the lock holder, so parallel loops stay safe.
 */

/** Steps per kick: 400 files = 16 batches + 6 steps, with room to spare. */
export const LOCAL_MAX_STEPS = 100;

interface LoopState {
  running: boolean;
  again: boolean;
}

const KEY = Symbol.for("flowmotion.localWorker.v2");

function loopState(userId: string): LoopState {
  const holder = globalThis as typeof globalThis & { [KEY]?: Map<string, LoopState> };
  holder[KEY] ??= new Map();
  let state = holder[KEY].get(userId);
  if (state === undefined) {
    state = { running: false, again: false };
    holder[KEY].set(userId, state);
  }
  return state;
}

function stripNulls(fields: Record<string, string | number | boolean | null>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) if (value !== null) out[key] = value;
  return out;
}

/** Worker deps for the local runner; `claimUserId` is always set (D-27). */
export function localDeps(userId: string): WorkerDeps {
  const env = getServerEnv();
  return {
    db: createSupabaseWorkerDb(createAdminClient()),
    github: createWorkerGitHub({ appId: env.GITHUB_APP_ID, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY }),
    model: createModelFromEnv(process.env),
    now: () => new Date(),
    workerId: `local-${crypto.randomUUID()}`,
    claimUserId: userId,
    log: (event, fields) => logServerInfo(`worker:${event}`, stripNulls(fields)),
  };
}

/** Runs steps until no job of this user is due (or the step limit). Never throws. */
export async function drainLocal(deps: WorkerDeps, maxSteps = LOCAL_MAX_STEPS): Promise<number> {
  if (deps.claimUserId === undefined) {
    // The local runner must never claim without a user id (D-27).
    logServerError("worker:local", new Error("claim without user id refused"));
    return 0;
  }
  let steps = 0;
  try {
    while (steps < maxSteps) {
      const result = await runOnce(deps);
      if (result.outcome === "idle") break;
      steps += 1;
      if (!result.more) break;
    }
  } catch (error) {
    logServerError("worker:local", error);
  }
  return steps;
}

/** Fire-and-forget: starts this user's in-process loop, or queues one more pass. */
export function kickLocalWorker(
  userId: string,
  run: () => Promise<unknown> = () => drainLocal(localDeps(userId)),
): void {
  const state = loopState(userId);
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  state.again = false;
  void Promise.resolve()
    .then(run)
    .catch((error: unknown) => logServerError("worker:local", error))
    .finally(() => {
      state.running = false;
      if (state.again) kickLocalWorker(userId, run);
    });
}
