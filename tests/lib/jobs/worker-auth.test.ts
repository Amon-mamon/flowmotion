// @vitest-environment node
/** D-30 / S2-6: worker bearer is WORKER_TOKEN, fail closed, constant-time compare. */
import { describe, expect, it } from "vitest";

import { isWorkerRequestAuthorized, isWorkerTokenConfigured } from "@/lib/jobs/worker-auth";

const TOKEN = "0123456789abcdef".repeat(4);

describe("worker auth", () => {
  it("correct token accepted", () => {
    expect(isWorkerRequestAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });
  it("missing or wrong bearer → rejected", () => {
    expect(isWorkerRequestAuthorized(null, TOKEN)).toBe(false);
    expect(isWorkerRequestAuthorized("", TOKEN)).toBe(false);
    expect(isWorkerRequestAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isWorkerRequestAuthorized(`Bearer ${TOKEN.slice(0, 63)}`, TOKEN)).toBe(false);
    expect(isWorkerRequestAuthorized(TOKEN, TOKEN)).toBe(false);
  });
  it("missing or short configured token rejects everything (fail closed)", () => {
    expect(isWorkerRequestAuthorized("Bearer ", undefined)).toBe(false);
    expect(isWorkerRequestAuthorized("Bearer short", "short")).toBe(false);
    expect(isWorkerRequestAuthorized("Bearer ", "")).toBe(false);
    expect(isWorkerTokenConfigured("a".repeat(63))).toBe(false);
    expect(isWorkerTokenConfigured("a".repeat(64))).toBe(true);
  });
});
