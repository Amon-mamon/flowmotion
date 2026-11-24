import { describe, expect, it } from "vitest";
import { ALLOWED_NODE_TYPES } from "@/lib/n8n-catalog/allowlist";
import { analyzeStateSchema } from "@/lib/jobs/types";
import { MAX_DRAFTS } from "@/schemas/recommendation";

// S2d-1: job state never holds more than MAX_DRAFTS drafts, independent of parseDrafts.
const draft = {
  title: "Notify on signup",
  description: "Send a Slack message when a user signs up.",
  trigger_kind: "webhook",
  confidence: 0.6,
  source_files: ["src/app/api/signup/route.ts"],
  required_credentials: [],
  risk_level: "low",
  node_types: [ALLOWED_NODE_TYPES[0]],
  rationale: "Signup is a clear success event.",
};

describe("analyzeStateSchema drafts cap (S2d-1)", () => {
  const draftsSchema = analyzeStateSchema.shape.drafts;

  it("accepts exactly MAX_DRAFTS drafts", () => {
    expect(draftsSchema.safeParse(Array.from({ length: MAX_DRAFTS }, () => draft)).success).toBe(true);
  });

  it("rejects more than MAX_DRAFTS drafts", () => {
    expect(draftsSchema.safeParse(Array.from({ length: MAX_DRAFTS + 1 }, () => draft)).success).toBe(false);
  });
});
