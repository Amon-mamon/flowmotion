// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ALLOWED_NODE_TYPES, type AllowedNodeType } from "@/lib/n8n-catalog/allowlist";
import { NODE_PROFILES } from "@/lib/n8n-catalog/profiles";
import { stableId } from "@/lib/n8n-catalog/profiles/types";

interface Sample {
  /** One accepted params object. */
  ok: Record<string, unknown>;
  /** The same params with one value of the wrong type. */
  wrongType: unknown;
  /** Fields that must hold a `YOUR_…` placeholder. */
  placeholders?: string[];
}

const pair = { name: "status", value: "{{ $json.status }}" };
const condition = { left: "{{ $json.total }}", op: "gt", right: 10 };

const SAMPLES: Record<string, Sample> = {
  manualTrigger: { ok: {}, wrongType: [] },
  noOp: { ok: {}, wrongType: "nothing" },
  webhook: {
    ok: { path: "new-order", method: "POST", respond: "immediately" },
    wrongType: { path: "new-order", method: "post", respond: "immediately" },
  },
  scheduleTrigger: { ok: { cron: "*/15 * * * 1-5" }, wrongType: { cron: 5 } },
  respondToWebhook: { ok: { statusCode: 201, body: [{ name: "ok", value: true }] }, wrongType: { statusCode: "201", body: [{ name: "ok", value: true }] } },
  if: { ok: { conditions: [condition], combine: "and" }, wrongType: { conditions: condition, combine: "and" } },
  filter: {
    ok: { conditions: [{ left: "{{ $json.active }}", op: "isTrue" }], combine: "or" },
    wrongType: { conditions: [{ left: "{{ $json.active }}", op: "isTrue" }], combine: "xor" },
  },
  switch: {
    ok: { value: "{{ $json.kind }}", cases: ["a", 2], fallback: false },
    wrongType: { value: "{{ $json.kind }}", cases: ["a", true], fallback: false },
  },
  set: { ok: { fields: [pair], keepOtherFields: true }, wrongType: { fields: [pair], keepOtherFields: "yes" } },
  merge: { ok: { mode: "append" }, wrongType: { mode: "combine" } },
  splitInBatches: { ok: { batchSize: 10 }, wrongType: { batchSize: 0 } },
  splitOut: { ok: { field: "order.items" }, wrongType: { field: "order items" } },
  aggregate: { ok: { as: "items" }, wrongType: { as: 1 } },
  sort: { ok: { by: [{ field: "created_at", order: "desc" }] }, wrongType: { by: [{ field: "created_at", order: "down" }] } },
  limit: { ok: { maxItems: 5, keep: "last" }, wrongType: { maxItems: 5.5, keep: "last" } },
  removeDuplicates: { ok: { fields: [] }, wrongType: { fields: "email" } },
  renameKeys: { ok: { keys: [{ from: "a.b", to: "c" }] }, wrongType: { keys: [{ from: "a.b", to: "c.d" }] } },
  dateTime: {
    ok: { operation: "format", value: "{{ $json.created }}", format: "iso", as: "createdIso" },
    wrongType: { operation: "format", value: "{{ $json.created }}", format: "dd/MM", as: "createdIso" },
  },
  wait: { ok: { seconds: 30 }, wrongType: { seconds: 4000 } },
  stopAndError: { ok: { message: "Order {{ $json.id }} is invalid" }, wrongType: { message: "" } },
  httpRequest: {
    ok: { method: "GET", baseUrl: "YOUR_APP_URL", path: "/api/orders", query: [pair], headers: [], jsonBody: [pair] },
    wrongType: { method: "GET", baseUrl: "YOUR_APP_URL", path: "api/orders" },
    placeholders: ["baseUrl"],
  },
  emailSend: {
    ok: { from: "YOUR_FROM_EMAIL", to: "YOUR_TO_EMAIL", subject: "Hi", text: "Body" },
    wrongType: { from: "YOUR_FROM_EMAIL", to: "YOUR_TO_EMAIL", subject: 1, text: "Body" },
    placeholders: ["from", "to"],
  },
  slack: {
    ok: { channel: "YOUR_SLACK_CHANNEL", text: "Hi" },
    wrongType: { channel: "YOUR_SLACK_CHANNEL", text: ["Hi"] },
    placeholders: ["channel"],
  },
  discord: { ok: { text: "Hi" }, wrongType: { text: null } },
  telegram: {
    ok: { chatId: "YOUR_CHAT_ID", text: "Hi" },
    wrongType: { chatId: "YOUR_CHAT_ID", text: 5 },
    placeholders: ["chatId"],
  },
  gmail: {
    ok: { to: "YOUR_TO_EMAIL", subject: "Hi", message: "Body" },
    wrongType: { to: "YOUR_TO_EMAIL", subject: "Hi", message: {} },
    placeholders: ["to"],
  },
  googleSheets: {
    ok: { operation: "append", documentId: "YOUR_SHEET_ID", sheetName: "YOUR_SHEET_NAME", columns: [pair] },
    wrongType: { operation: "append", documentId: "YOUR_SHEET_ID", sheetName: "YOUR_SHEET_NAME", columns: [] },
    placeholders: ["documentId", "sheetName"],
  },
  notion: {
    ok: { databaseId: "YOUR_NOTION_DATABASE_ID", title: "{{ $json.title }}" },
    wrongType: { databaseId: "YOUR_NOTION_DATABASE_ID", title: 7 },
    placeholders: ["databaseId"],
  },
  airtable: {
    ok: { baseId: "YOUR_BASE_ID", table: "YOUR_TABLE_ID", fields: [pair] },
    wrongType: { baseId: "YOUR_BASE_ID", table: "YOUR_TABLE_ID", fields: {} },
    placeholders: ["baseId", "table"],
  },
  github: {
    ok: { owner: "YOUR_GITHUB_OWNER", repo: "YOUR_GITHUB_REPO", title: "Bug", body: "Details" },
    wrongType: { owner: "YOUR_GITHUB_OWNER", repo: "YOUR_GITHUB_REPO", title: "Bug", body: 1 },
    placeholders: ["owner", "repo"],
  },
  postgres: {
    ok: { operation: "insert", table: "orders", columns: [{ name: "total", value: 5 }] },
    wrongType: { operation: "insert", table: "orders; drop table users", columns: [{ name: "total", value: 5 }] },
  },
  supabase: {
    ok: { operation: "select", table: "orders", limit: 10 },
    wrongType: { operation: "select", table: "orders", limit: 1000 },
  },
};

const short = (type: AllowedNodeType) => type.slice("n8n-nodes-base.".length);

describe("node profiles (node-catalog.md 'FlowSpec parameters')", () => {
  it("has a sample for every allowed node", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(ALLOWED_NODE_TYPES.map(short).sort());
  });

  describe.each(ALLOWED_NODE_TYPES)("%s", (type) => {
    const profile = NODE_PROFILES[type];
    const sample = SAMPLES[short(type)] ?? { ok: {}, wrongType: null };

    it("accepts a valid params object and emits n8n parameters", () => {
      expect(profile.paramsSchema.safeParse(sample.ok).success).toBe(true);
      const parameters = profile.toParameters(sample.ok);
      expect(typeof parameters).toBe("object");
      const outputs = profile.outputs(sample.ok);
      expect(profile.outputLabels(sample.ok)).toHaveLength(outputs);
      // Profiles never add the expression prefix: only the compiler does.
      expect(JSON.stringify(parameters)).not.toMatch(/"=/);
    });

    it("rejects an unknown key", () => {
      expect(profile.paramsSchema.safeParse({ ...sample.ok, authentication: "predefinedCredentialType" }).success).toBe(false);
    });

    it("rejects a wrong type", () => {
      expect(profile.paramsSchema.safeParse(sample.wrongType).success).toBe(false);
      expect(() => profile.toParameters(sample.wrongType)).toThrow();
    });

    it.each(sample.placeholders ?? [])("rejects a literal where a Placeholder is required: %s", (field) => {
      for (const literal of ["ops@example.com", "#general", "https://example.com", "your_value", "YOUR_", "{{ $json.to }}"]) {
        expect(profile.paramsSchema.safeParse({ ...sample.ok, [field]: literal }).success, literal).toBe(false);
      }
    });
  });

  it("every destination node has at least one placeholder field", () => {
    for (const name of ["httpRequest", "emailSend", "slack", "telegram", "gmail", "googleSheets", "notion", "airtable", "github"]) {
      expect(SAMPLES[name]?.placeholders?.length ?? 0, name).toBeGreaterThan(0);
    }
  });
});

describe("profile details", () => {
  it("output counts and labels: if, splitInBatches, switch, stopAndError", () => {
    expect(NODE_PROFILES["n8n-nodes-base.if"].outputLabels(SAMPLES.if?.ok)).toEqual(["true", "false"]);
    expect(NODE_PROFILES["n8n-nodes-base.splitInBatches"].outputLabels({ batchSize: 5 })).toEqual(["done", "loop"]);
    const switchProfile = NODE_PROFILES["n8n-nodes-base.switch"];
    expect(switchProfile.outputs({ value: "x", cases: ["a", "b"], fallback: false })).toBe(2);
    expect(switchProfile.outputLabels({ value: "x", cases: ["a", 2], fallback: true })).toEqual(["a", "2", "fallback"]);
    expect(NODE_PROFILES["n8n-nodes-base.stopAndError"].outputs({ message: "x" })).toBe(0);
  });

  it("switch rejects duplicate cases and case values that could be evaluated", () => {
    const schema = NODE_PROFILES["n8n-nodes-base.switch"].paramsSchema;
    expect(schema.safeParse({ value: "x", cases: ["a", "a"], fallback: false }).success).toBe(false);
    expect(schema.safeParse({ value: "x", cases: ["={{ $env.A }}"], fallback: false }).success).toBe(false);
    expect(schema.safeParse({ value: "x", cases: ["{{ $json.a }}"], fallback: false }).success).toBe(false);
  });

  it("httpRequest rejects authentication headers in any case, literal hosts, and non-URL placeholders", () => {
    const schema = NODE_PROFILES["n8n-nodes-base.httpRequest"].paramsSchema;
    const base = { method: "GET", baseUrl: "YOUR_APP_URL", path: "/x" };
    expect(schema.safeParse(base).success).toBe(true);
    for (const name of ["Authorization", "authorization", "COOKIE", "Cookie"]) {
      expect(schema.safeParse({ ...base, headers: [{ name, value: "x" }] }).success, name).toBe(false);
    }
    // Hyphenated names are not FieldNames, so these can never be written either.
    for (const name of ["x-api-key", "Proxy-Authorization"]) {
      expect(schema.safeParse({ ...base, headers: [{ name, value: "x" }] }).success, name).toBe(false);
    }
    expect(schema.safeParse({ ...base, baseUrl: "YOUR_APP_HOST" }).success).toBe(false);
    expect(schema.safeParse({ ...base, baseUrl: "https://evil.example" }).success).toBe(false);
    expect(schema.safeParse({ ...base, path: "https://evil.example/x" }).success).toBe(false);
    expect(schema.safeParse({ ...base, path: "/x?next=http://evil.example" }).success).toBe(false);
  });

  it("httpRequest emits the placeholder origin followed by the path", () => {
    const parameters = NODE_PROFILES["n8n-nodes-base.httpRequest"].toParameters({
      method: "POST",
      baseUrl: "YOUR_APP_URL",
      path: "/api/orders/{{ $json.id }}",
    });
    expect(parameters.url).toBe("YOUR_APP_URL/api/orders/{{ $json.id }}");
    expect(parameters.authentication).toBe("none");
    expect(parameters).not.toHaveProperty("headerParameters");
  });

  it("postgres and supabase take identifiers only, never SQL", () => {
    for (const type of ["n8n-nodes-base.postgres", "n8n-nodes-base.supabase"] as const) {
      const schema = NODE_PROFILES[type].paramsSchema;
      expect(schema.safeParse({ operation: "executeQuery", query: "select 1" }).success).toBe(false);
      expect(schema.safeParse({ operation: "select", table: "Orders", limit: 5 }).success).toBe(false);
      expect(schema.safeParse({ operation: "insert", table: "t", columns: [{ name: "a b", value: 1 }] }).success).toBe(false);
      expect(schema.safeParse({ operation: "select", table: "t", limit: 5, query: "select 1" }).success).toBe(false);
      expect(JSON.stringify(NODE_PROFILES[type].toParameters({ operation: "select", table: "t", limit: 5 }))).not.toMatch(
        /executeQuery|query/,
      );
    }
  });

  it("respondToWebhook JSON-escapes literal text; a {{ in a body value is refused (D-52)", () => {
    const profile = NODE_PROFILES["n8n-nodes-base.respondToWebhook"];
    const parameters = profile.toParameters({
      statusCode: 200,
      body: [
        { name: "note", value: 'say "hi"\nbye' },
        { name: "count", value: 3 },
        { name: "ok", value: true },
      ],
    });
    expect(parameters.responseBody).toBe('{"note": "say \\"hi\\"\\nbye", "count": 3, "ok": true}');
    expect(profile.toParameters({ statusCode: 204, body: [] }).responseBody).toBe("{}");
    expect(profile.paramsSchema.safeParse({ statusCode: 200, body: [{ name: "id", value: "{{ $json.id }}" }] }).success).toBe(false);
    expect(profile.paramsSchema.safeParse({ statusCode: 200, body: [{ name: "id", value: "order {{ $json.id }}" }] }).success).toBe(false);
  });

  it("stableId is deterministic, UUID-shaped, and distinct per seed", () => {
    const id = stableId("node:start");
    expect(id).toBe(stableId("node:start"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ids = new Set(Array.from({ length: 500 }, (_, index) => stableId(`node:n${index}`)));
    expect(ids.size).toBe(500);
  });
});
