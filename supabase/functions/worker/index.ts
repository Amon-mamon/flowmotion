/**
 * Job worker Edge Function (Deno; contract sections 4, 9 and 11 item 9;
 * D-10, D-12). Imports the runtime-neutral pipeline from src/lib through
 * supabase/functions/import_map.json. Each invocation runs at most one step
 * (`runOnce`) and, when a job was claimed, calls itself once more so the
 * chain continues without waiting for the optional pg_cron tick.
 *
 * Auth (D-30): `Authorization: Bearer <WORKER_TOKEN>` (function secret, at
 * least 64 chars), constant-time compare, every request rejected when the
 * secret is missing or short. The injected service-role key is used for
 * database access only, never as a bearer. Logs carry ids, steps and codes only.
 */
import { createClient } from "@supabase/supabase-js";

import { createModelFromEnv, createWorkerGitHub } from "@/lib/jobs/runtime";
import { createSupabaseWorkerDb } from "@/lib/jobs/supabase-db";
import { runOnce } from "@/lib/jobs/worker";
import { isWorkerRequestAuthorized } from "@/lib/jobs/worker-auth";

declare const Deno: {
  env: { get(name: string): string | undefined; toObject(): Record<string, string> };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function log(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info(`[worker] ${event}`, fields);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { ok: false });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const workerToken = Deno.env.get("WORKER_TOKEN");
  if (!isWorkerRequestAuthorized(request.headers.get("authorization"), workerToken)) {
    return json(401, { ok: false });
  }

  const appId = Deno.env.get("GITHUB_APP_ID") ?? "";
  const privateKeyPem = Deno.env.get("GITHUB_APP_PRIVATE_KEY") ?? "";
  if (supabaseUrl === "" || serviceKey === "" || appId === "" || privateKeyPem === "") {
    log("config.missing", { supabaseUrl: supabaseUrl !== "", appId: appId !== "", privateKey: privateKeyPem !== "" });
    return json(500, { ok: false });
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const workerId = `edge-${crypto.randomUUID()}`;
  try {
    const result = await runOnce({
      db: createSupabaseWorkerDb(client),
      github: createWorkerGitHub({ appId, privateKeyPem }),
      // A missing ANALYSIS_MODEL secret means disabled (fail safe, D-16).
      model: createModelFromEnv(Deno.env.toObject()),
      now: () => new Date(),
      workerId,
      log,
    });
    if (result.more) {
      const next = fetch(`${supabaseUrl}/functions/v1/worker`, {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken ?? ""}`, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      })
        .then(() => undefined)
        .catch(() => log("selfcall.failed", { workerId }));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(next);
    }
    return json(200, { ok: true, outcome: result.outcome });
  } catch (error) {
    log("run.failed", { workerId, name: error instanceof Error ? error.name : "unknown" });
    return json(500, { ok: false });
  }
});
