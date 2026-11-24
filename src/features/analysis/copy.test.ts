import { describe, expect, it } from "vitest";

import { failedMessage } from "@/features/analysis/copy";
import type { JobErrorCode } from "@/features/analysis/schemas";

describe("failedMessage (design.md exact copy)", () => {
  it("JOB_EXPIRED (D-29)", () => {
    expect(failedMessage("JOB_EXPIRED")).toBe("This analysis stopped making progress and was cancelled. Try again.");
  });

  it("AI_UNAVAILABLE (D-35)", () => {
    expect(failedMessage("AI_UNAVAILABLE")).toBe(
      "The AI service did not respond. Your security findings and detected signals are saved below. Try again later.",
    );
  });

  it("INTERNAL and null fall back to the generic message", () => {
    expect(failedMessage("INTERNAL")).toBe("Something went wrong during analysis. Try again.");
    expect(failedMessage(null)).toBe("Something went wrong during analysis. Try again.");
  });

  it("an unknown code (newer server) falls back to the INTERNAL message", () => {
    expect(failedMessage("SOMETHING_NEW" as unknown as JobErrorCode)).toBe(
      "Something went wrong during analysis. Try again.",
    );
  });
});
