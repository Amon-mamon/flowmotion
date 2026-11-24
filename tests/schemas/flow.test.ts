// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  flowDetailSchema,
  flowsResponseSchema,
  flowSummarySchema,
  generateBodySchema,
  generateResponseSchema,
  isJsonValue,
  jsonValueSchema,
  setupChecklistSchema,
  type FlowDetail,
} from "@/schemas/flow";

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const detail: FlowDetail = {
  id: ID(1),
  recommendationId: ID(2),
  analysisId: ID(3),
  projectId: ID(4),
  repoFullName: "acme/shop",
  name: "Order alerts",
  description: "Alerts the team.",
  status: "ready",
  errorCode: null,
  n8nVersion: "2.49.5",
  catalogVersion: "2.49.5+fm1",
  importVerified: false,
  nodes: [
    {
      key: "start",
      label: "Start",
      nodeType: "n8n-nodes-base.webhook",
      tier: 1,
      isTrigger: true,
      params: { path: "x", method: "POST", respond: "immediately" },
      credential: null,
      sourceFiles: ["src/app/api/orders/route.ts"],
      notes: null,
      position: { x: 250, y: 300 },
      inputs: 0,
      outputs: 1,
      outputLabels: [""],
    },
  ],
  edges: [{ id: "start:0->next:0", from: "start", to: "next", output: 0, input: 0 }],
  checklist: { credentials: [{ name: "Slack", usedBy: ["Notify"] }], placeholders: [], warnings: ["Review."] },
  latestTestRun: null,
  createdAt: "2026-11-25T10:00:00+00:00",
};

describe("flow DTO schemas (contract section 6)", () => {
  it("FlowDetail: ready, generating and failed shapes", () => {
    expect(flowDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      flowDetailSchema.safeParse({ ...detail, status: "generating", nodes: [], edges: [], checklist: null, n8nVersion: null, catalogVersion: null, description: null })
        .success,
    ).toBe(true);
    expect(flowDetailSchema.safeParse({ ...detail, status: "failed", errorCode: "GENERATION_EXHAUSTED", nodes: [], edges: [], checklist: null }).success).toBe(true);
    expect(flowDetailSchema.safeParse({ ...detail, status: "done" }).success).toBe(false);
    expect(flowDetailSchema.safeParse({ ...detail, errorCode: "NOPE" }).success).toBe(false);
    expect(flowDetailSchema.safeParse({ ...detail, nodes: [{ ...detail.nodes[0], tier: 3 }] }).success).toBe(false);
    expect(
      flowDetailSchema.safeParse({ ...detail, latestTestRun: { id: ID(5), level: "valid", passed: true, createdAt: detail.createdAt } }).success,
    ).toBe(true);
  });

  it("FlowSummary and the list response", () => {
    const summary = {
      id: ID(1),
      recommendationId: ID(2),
      analysisId: ID(3),
      projectId: ID(4),
      repoFullName: "acme/shop",
      name: "Order alerts",
      status: "failed",
      errorCode: "AI_UNAVAILABLE",
      createdAt: detail.createdAt,
    };
    expect(flowSummarySchema.safeParse(summary).success).toBe(true);
    expect(flowsResponseSchema.safeParse({ flows: [summary] }).success).toBe(true);
    expect(flowsResponseSchema.safeParse({ flows: [{ ...summary, id: "1" }] }).success).toBe(false);
  });

  it("GenerateBody: 1..8 unique uuids, optional allowStale", () => {
    expect(generateBodySchema.safeParse({ recommendationIds: [ID(1)] }).success).toBe(true);
    expect(generateBodySchema.safeParse({ recommendationIds: [ID(1), ID(2)], allowStale: true }).success).toBe(true);
    expect(generateBodySchema.safeParse({ recommendationIds: [] }).success).toBe(false);
    expect(generateBodySchema.safeParse({ recommendationIds: [ID(1), ID(1)] }).success).toBe(false);
    expect(generateBodySchema.safeParse({ recommendationIds: Array.from({ length: 9 }, (_, i) => ID(i)) }).success).toBe(false);
    expect(generateBodySchema.safeParse({ recommendationIds: ["nope"] }).success).toBe(false);
    expect(generateBodySchema.safeParse({ recommendationIds: [ID(1)], allowStale: "yes" }).success).toBe(false);
    expect(generateResponseSchema.safeParse({ flowIds: [ID(1)] }).success).toBe(true);
  });

  it("SetupChecklist", () => {
    expect(setupChecklistSchema.safeParse({ credentials: [], placeholders: [], warnings: [] }).success).toBe(true);
    expect(setupChecklistSchema.safeParse({ credentials: [], placeholders: [] }).success).toBe(false);
  });

  it("JsonValue: plain JSON only, bounded depth", () => {
    for (const value of [null, "a", 1, true, [1, "a", null], { a: { b: [1] } }]) {
      expect(jsonValueSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [undefined, Number.NaN, new Date(0), () => 1, { a: undefined }, new Map(), BigInt(10)]) {
      expect(jsonValueSchema.safeParse(value).success).toBe(false);
    }
    let deep: unknown = 1;
    for (let index = 0; index < 32; index += 1) deep = { deep };
    expect(isJsonValue(deep)).toBe(true);
    expect(isJsonValue({ deep })).toBe(false);
  });
});
