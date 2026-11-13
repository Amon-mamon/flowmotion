import { describe, expect, it } from "vitest";

import { failedMessage } from "@/features/analysis/copy";

describe("failedMessage (design.md exact copy)", () => {
  it("JOB_EXPIRED (D-29)", () => {
    expect(failedMessage("JOB_EXPIRED")).toBe("This analysis stopped making progress and was cancelled. Try again.");
  });

  it("INTERNAL and null fall back to the generic message", () => {
    expect(failedMessage("INTERNAL")).toBe("Something went wrong during analysis. Try again.");
    expect(failedMessage(null)).toBe("Something went wrong during analysis. Try again.");
  });
});
