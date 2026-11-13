// @vitest-environment node
/** Local dev runner (D-26, D-27): drives the real state machine with fakes; claims only the triggering user's jobs. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { JobRow, WorkerDeps } from "@/lib/jobs/types";
import { drainLocal, kickLocalWorker, localDeps } from "@/server/jobs/local-runner";

import { FakeClock, FakeGitHub, FakeWorkerDb, USER } from "../lib/jobs/fakes";

const OTHER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setup(claimUserId: string | null = USER): { deps: WorkerDeps; db: FakeWorkerDb; clock: FakeClock } {
  const clock = new FakeClock();
  const db = new FakeWorkerDb(clock);
  db.seed();
  const github = new FakeGitHub({
    "package.json": JSON.stringify({ dependencies: { next: "16" } }),
    "src/app/api/hello/route.ts": "export async function GET() {}",
  });
  return {
    db,
    clock,
    deps: {
      db,
      github,
      model: null,
      now: clock.now,
      workerId: "local-test",
      ...(claimUserId !== null ? { claimUserId } : {}),
    },
  };
}

describe("local runner", () => {
  it("drainLocal runs the user's analysis from queued to done in one kick", async () => {
    const { deps, db } = setup();
    const steps = await drainLocal(deps);
    expect(steps).toBeGreaterThanOrEqual(6);
    expect(db.analysis).toMatchObject({ status: "done", error_code: "AI_DISABLED", progress: 100 });
    expect(db.job).toMatchObject({ status: "done", state: {} });
  });

  it("never calls claim_job without a user id", async () => {
    const { deps, db } = setup();
    await drainLocal(deps);
    expect(db.claimCalls.length).toBeGreaterThan(0);
    expect(db.claimCalls.every(([, userId]) => userId === USER)).toBe(true);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noUser = setup(null);
    expect(await drainLocal(noUser.deps)).toBe(0);
    expect(noUser.db.claimCalls).toEqual([]);
  });

  it("localDeps always carries the triggering user id", () => {
    expect(localDeps(USER).claimUserId).toBe(USER);
  });

  it("a due job of another user is not claimed", async () => {
    const { deps, db } = setup(OTHER_USER);
    expect(await drainLocal(deps)).toBe(0);
    expect(db.job).toMatchObject({ status: "queued", attempts: 0 });
    expect(db.claimCalls.every(([, userId]) => userId === OTHER_USER)).toBe(true);
  });

  it("two users kicking: each loop processes only its own job", async () => {
    const { db, clock, deps } = setup();
    const otherJob: JobRow = {
      ...structuredClone(db.job),
      id: "55555555-5555-4555-8555-555555555556",
      user_id: OTHER_USER,
      ref_id: "44444444-4444-4444-8444-444444444445",
    };
    db.jobs.push(otherJob);
    db.analyses.set(otherJob.ref_id, { ...db.analysis, id: otherJob.ref_id, user_id: OTHER_USER });
    void clock;
    await Promise.all([drainLocal(deps), drainLocal({ ...deps, claimUserId: OTHER_USER, workerId: "local-other" })]);
    expect(db.jobs.every((job) => job.status !== "running")).toBe(true);
    // The other user's job belongs to a project of USER in the fake; it still only ran under OTHER_USER's loop.
    const claimedBy = new Map(db.claimCalls.map(([worker, user]) => [worker, user]));
    expect(claimedBy.get("local-test")).toBe(USER);
    expect(claimedBy.get("local-other")).toBe(OTHER_USER);
    expect(db.job.status).toBe("done");
  });

  it("drainLocal respects the step limit and never throws", async () => {
    const { deps } = setup();
    expect(await drainLocal(deps, 2)).toBe(2);
    const broken = { ...deps, db: { ...deps.db, claimJob: async () => { throw new Error("db down"); } } } as WorkerDeps;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(drainLocal(broken)).resolves.toBe(0);
  });

  it("kickLocalWorker runs one loop per user and coalesces kicks into one more pass", async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const otherRun = vi.fn(async () => undefined);
    kickLocalWorker("user-1", run);
    kickLocalWorker("user-1", run);
    kickLocalWorker("user-1", run);
    kickLocalWorker("user-2", otherRun);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(otherRun).toHaveBeenCalledTimes(1));
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(2);
  });
});
