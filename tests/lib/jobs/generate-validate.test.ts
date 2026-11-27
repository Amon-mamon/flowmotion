// @vitest-environment node
/**
 * Phase 3b `validate` step (D-50, D-59): a `validateWorkflow` failure and an
 * `assertExportSafe` failure each become feedback and send the job back to
 * `ai` for another call, logged as `flow.validation_failed` by rule id only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inject = vi.hoisted(() => ({
  validator: [] as ({ ok: true } | { ok: false; errors: { rule: number; nodeName?: string }[] })[],
  exportSafe: [] as (string | null)[],
}));

vi.mock("@/lib/validator", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/validator")>();
  return {
    ...real,
    validateWorkflow: (workflow: unknown, checklist: unknown) => {
      const next = inject.validator.shift();
      return next ?? real.validateWorkflow(workflow, checklist);
    },
    assertExportSafe: (workflow: unknown) => {
      const next = inject.exportSafe.shift();
      if (typeof next === "string") throw new real.ExportNotSafeError(next as "secret");
      real.assertExportSafe(workflow);
    },
  };
});

import { createFakeGenerationModel } from "@/lib/generation/fake";
import type { WorkerDeps } from "@/lib/jobs/types";
import { runOnce } from "@/lib/jobs/worker";

import { FakeClock, FakeGitHub, FakeWorkerDb } from "./fakes";

function setup() {
  const clock = new FakeClock();
  const db = new FakeWorkerDb(clock);
  db.seedGeneration({ sourceFiles: [] });
  const model = createFakeGenerationModel();
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const deps: WorkerDeps = {
    db,
    github: new FakeGitHub({}),
    model,
    now: clock.now,
    workerId: "w",
    log: (event, fields) => logs.push({ event, fields }),
  };
  return { db, deps, model, logs, clock };
}

async function drain(deps: WorkerDeps, db: FakeWorkerDb) {
  for (let i = 0; i < 40 && db.job.status !== "done" && db.job.status !== "failed"; i += 1) await runOnce(deps);
}

beforeEach(() => {
  inject.validator = [];
  inject.exportSafe = [];
});

describe("validate step feedback", () => {
  it("an injected validator failure → back to ai with V feedback (node key mapped from the label), then ready", async () => {
    inject.validator = [{ ok: false, errors: [{ rule: 7, nodeName: "Notify Team" }] }];
    const { db, deps, model, logs } = setup();
    await drain(deps, db);
    expect(db.flow.status).toBe("ready");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("- V7 (node notify)");
    const line = logs.find((entry) => entry.event === "flow.validation_failed");
    expect(line?.fields).toMatchObject({ rules: "V7", nodeKeys: "notify" });
  });

  it("an injected assertExportSafe failure → back to ai with EXPORT_SECRET feedback and another call", async () => {
    inject.exportSafe = ["secret"];
    const { db, deps, model, logs } = setup();
    await drain(deps, db);
    expect(db.flow.status).toBe("ready");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("- EXPORT_SECRET");
    expect(logs.find((entry) => entry.event === "flow.validation_failed")?.fields.rules).toBe("EXPORT_SECRET");
  });

  it("validation failing on every call → GENERATION_EXHAUSTED after 3 calls", async () => {
    inject.exportSafe = ["type", "type", "type"];
    const { db, deps, model } = setup();
    await drain(deps, db);
    expect(db.flow.status).toBe("failed");
    expect(db.flow.error_code).toBe("GENERATION_EXHAUSTED");
    expect(model.calls).toHaveLength(3);
  });
});
