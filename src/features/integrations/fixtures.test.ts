import { describe, expect, it } from "vitest";

import { PROVIDER_COPY } from "@/features/integrations/copy";
import { PREVIEW_STATE_IDS, PREVIEW_STATES } from "@/features/integrations/fixtures";
import { formatRelativeDate, isFreeModel, modelAfterProviderSwitch } from "@/features/integrations/model";
import {
  aiModelIdSchema,
  aiProviderFormSchema,
  aiProviderPutBodySchema,
  aiProviderResponseSchema,
} from "@/features/integrations/types";

describe("integrations fixtures", () => {
  it("has one fixture per preview state with the design.md labels", () => {
    expect(PREVIEW_STATE_IDS.map((id) => PREVIEW_STATES[id].label)).toEqual([
      "No key saved",
      "Saved, not tested",
      "Working",
      "Invalid key",
      "No credit",
      "Model not found",
      "Provider did not respond",
      "Free model",
    ]);
  });

  it.each(PREVIEW_STATE_IDS)("%s passes AiProviderResponse", (id) => {
    expect(aiProviderResponseSchema.safeParse(PREVIEW_STATES[id].response).success).toBe(true);
  });

  it("contains only key hints, never a full key-shaped string", () => {
    const json = JSON.stringify(PREVIEW_STATES);
    const keyShaped = json.match(/sk-(?:or|ant)-[^"]*/g) ?? [];
    for (const match of keyShaped) {
      expect(match).toMatch(/^sk-(or|ant)-…\S{4}$/);
    }
    expect(keyShaped.length).toBeGreaterThan(0);
  });
});

describe("integrations schemas", () => {
  it("accepts the contract model examples and rejects bad ones", () => {
    for (const ok of ["anthropic/claude-haiku-5.5", "vendor/model:free", "claude-haiku-5-5"]) {
      expect(aiModelIdSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["", " ", "-model", "model name", "a".repeat(201)]) {
      expect(aiModelIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("the form schema has no apiKey field", () => {
    expect(Object.keys(aiProviderFormSchema.shape).sort()).toEqual(["model", "provider"]);
  });

  it("the put body checks the key prefix against the provider", () => {
    const sample = "x".repeat(24);
    expect(
      aiProviderPutBodySchema.safeParse({ provider: "anthropic", model: "m", apiKey: `sk-or-${sample}` }).success,
    ).toBe(false);
    expect(aiProviderPutBodySchema.safeParse({ provider: "openrouter", model: "m" }).success).toBe(true);
  });
});

describe("integrations model helpers", () => {
  it("detects :free in any case", () => {
    expect(isFreeModel("vendor/model:free")).toBe(true);
    expect(isFreeModel("vendor/model:FREE")).toBe(true);
    expect(isFreeModel("vendor/free-model")).toBe(false);
  });

  it("replaces only an empty or suggested model on provider switch", () => {
    const or = PROVIDER_COPY.openrouter.suggestedModel;
    const ant = PROVIDER_COPY.anthropic.suggestedModel;
    expect(modelAfterProviderSwitch(or, "openrouter", "anthropic")).toBe(ant);
    expect(modelAfterProviderSwitch("", "openrouter", "anthropic")).toBe(ant);
    expect(modelAfterProviderSwitch("my/model", "openrouter", "anthropic")).toBe("my/model");
  });

  it("formats relative dates", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    expect(formatRelativeDate("2026-11-27T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeDate("2026-11-27T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeDate("2026-11-26T12:00:00Z", now)).toBe("yesterday");
  });
});
