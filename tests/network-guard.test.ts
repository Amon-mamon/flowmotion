// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("network guard", () => {
  it("global fetch throws in every test", async () => {
    await expect(fetch("https://api.github.com/")).rejects.toThrow(/Network access is blocked/);
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow(/blocked/);
  });
});
