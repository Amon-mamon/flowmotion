// @vitest-environment node
/**
 * Phase 3a review fixes, second round (docs/review.md R3aR-1, R3aR-2;
 * docs/security-review.md S3aR-1..S3aR-5). Each block fails when its fix is
 * removed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { N8nWorkflow } from "@/lib/compiler";
import { checkFlowSpec, type FlowSpecRule } from "@/lib/flowspec";
import { scan } from "@/lib/security/secret-scanner";
import { allowedParams, requiredModes } from "@/lib/validator/allowed-params";
import { assertExportSafe, ExportNotSafeError, validateWorkflow, type ValidatorRule } from "@/lib/validator";
import type { JsonValue, SetupChecklist } from "@/schemas/flow";
import { flowSpecDraftSchema, type FlowSpecDraft } from "@/schemas/flowspec";

import { baseDraft, clone, compileSpec, goldenPath, SPEC_NAMES } from "../flow/helpers";

const R = (n: number, alphabet = "aZ3kQ9xLmP2vW7tR5yB8nC4dF6gH1jK0") =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const LIT = R(30);
const T = "9fK2mQ7xL4pR8vT1nB6cY3wZ5hJ0dS2a";
const ANTHROPIC = "sk-ant-" + "api03-" + R(40);

interface Fixture {
  workflow: N8nWorkflow;
  checklist: SetupChecklist;
}

function golden(name: string): Fixture {
  const workflow = JSON.parse(readFileSync(goldenPath(name), "utf8")) as N8nWorkflow;
  return { workflow, checklist: clone(compileSpec(name).checklist) };
}

function nodeOf(fixture: Fixture, name: string) {
  const found = fixture.workflow.nodes.find((item) => item.name === name);
  if (found === undefined) throw new Error(`No node ${name}`);
  return found;
}

function rulesOf(fixture: Fixture): ValidatorRule[] {
  const result = validateWorkflow(fixture.workflow, fixture.checklist);
  return result.ok ? [] : result.errors.map((error) => error.rule);
}

function mutated(name: string, mutate: (fixture: Fixture) => void): ValidatorRule[] {
  const fixture = golden(name);
  mutate(fixture);
  return rulesOf(fixture);
}

function exportRule(workflow: unknown): string | null {
  try {
    assertExportSafe(workflow);
    return null;
  } catch (error) {
    if (error instanceof ExportNotSafeError) return error.rule;
    throw error;
  }
}

function specRules(draft: FlowSpecDraft): FlowSpecRule[] {
  const result = checkFlowSpec(draft);
  return result.ok ? [] : result.errors.map((error) => error.rule);
}

function nested(depth: number): JsonValue {
  let value: JsonValue = "leaf";
  for (let i = 0; i < depth; i += 1) value = { d: value };
  return value;
}

function setField(name: string, value: string): FlowSpecDraft {
  const draft = baseDraft();
  draft.nodes[1]!.params = { fields: [{ name, value }], keepOtherFields: true };
  return draft;
}

function slackDraft(text: string): FlowSpecDraft {
  const draft = baseDraft();
  draft.nodes.push({
    key: "post",
    nodeType: "n8n-nodes-base.slack",
    label: "Post",
    params: { channel: "YOUR_SLACK_CHANNEL", text },
  });
  draft.edges.push({ from: "shape", to: "post" });
  return draft;
}

function setAssignment(fixture: Fixture, name: string, value: string): void {
  const list = (nodeOf(fixture, "Shape Order").parameters.assignments as { assignments: Record<string, JsonValue>[] })
    .assignments;
  list[0]!.name = name;
  list[0]!.value = value;
}

// --- R3aR-1 -----------------------------------------------------------------------

describe("R3aR-1: deep input never throws; it fails closed", () => {
  it("deep params: checkFlowSpec returns F9 instead of throwing", () => {
    const draft = baseDraft();
    draft.nodes[1]!.params = { deep: nested(31) };
    expect(flowSpecDraftSchema.safeParse(draft).success).toBe(true);
    expect(() => checkFlowSpec(draft)).not.toThrow();
    expect(specRules(draft)).toContain("F9");
  });

  it("deep test payload: checkFlowSpec returns F9 instead of throwing", () => {
    const draft = baseDraft();
    draft.tests.cases[0]!.trigger.payload = nested(31);
    expect(flowSpecDraftSchema.safeParse(draft).success).toBe(true);
    expect(() => checkFlowSpec(draft)).not.toThrow();
    expect(specRules(draft)).toEqual(["F9"]);
  });

  it("a deep respondToWebhook body: validateWorkflow and assertExportSafe refuse without throwing", () => {
    const fixture = golden("order-webhook");
    nodeOf(fixture, "Reply").parameters.responseBody = JSON.stringify(nested(31));
    expect(() => validateWorkflow(fixture.workflow, fixture.checklist)).not.toThrow();
    expect(rulesOf(fixture)).toEqual([6, 7]);
    expect(exportRule(fixture.workflow)).toBe("secret");
  });
});

// --- R3aR-2 / S3aR-3 -----------------------------------------------------------------

describe("R3aR-2 / S3aR-3: modes the profile always emits are required", () => {
  it("deleting operation, resource, or authentication fails rule 5", () => {
    expect(mutated("lead-import", (f) => delete nodeOf(f, "Insert Lead").parameters.operation)).toEqual([5]);
    expect(mutated("lead-import", (f) => delete nodeOf(f, "Mirror Lead").parameters.resource)).toEqual([5]);
    expect(mutated("nightly-report", (f) => delete nodeOf(f, "Push To CRM").parameters.authentication)).toEqual([5]);
  });

  it("every required mode of every golden node, when deleted, fails rule 5", () => {
    let checked = 0;
    for (const name of SPEC_NAMES) {
      for (const node of golden(name).workflow.nodes) {
        const table = allowedParams(node.type);
        if (table === undefined) throw new Error(`no table entry for ${node.type}`);
        for (const mode of requiredModes(table)) {
          if (!(mode in node.parameters)) throw new Error(`${name} ${node.name} lacks required ${mode}`);
          expect(mutated(name, (f) => delete nodeOf(f, node.name).parameters[mode]), `${name} ${node.name} ${mode}`).toContain(5);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});

// --- S3aR-1 ---------------------------------------------------------------------------

describe("S3aR-1: a placeholder marker never hides a real token", () => {
  it("flow probes fail F9 or rule 7 and assertExportSafe", () => {
    expect(specRules(setField("api_key", `YOUR_${T}`))).toEqual(["F9"]);
    expect(specRules(setField("password", `example ${T}`))).toEqual(["F9"]);
    expect(specRules(setField("password", `${T}{{ $json.body.id }}`))).toEqual(["F9"]);
    expect(specRules(slackDraft(`Key YOUR_${ANTHROPIC}`))).toEqual(["F9"]);
    expect(specRules(slackDraft(`Bearer YOUR_${T}`))).toEqual(["F9"]);
    const notes = baseDraft();
    notes.nodes[1]!.notes = `YOUR_${ANTHROPIC}`;
    expect(specRules(notes)).toEqual(["F9"]);

    for (const [name, value] of [
      ["api_key", `YOUR_${T}`],
      ["password", `=${T}{{ $json.body.id }}`],
      ["password", `example ${T}`],
      ["note", `YOUR_${ANTHROPIC}`],
      ["note", `Bearer YOUR_${T}`],
    ] as const) {
      const fixture = golden("order-webhook");
      setAssignment(fixture, name, value);
      expect(rulesOf(fixture), value.slice(0, 12)).toContain(7);
      expect(exportRule(fixture.workflow), value.slice(0, 12)).toBe("secret");
    }
  });

  it.each([
    `Authorization: Bearer YOUR_${T}`,
    `fetch("/v1?api_key=your-${T}")`,
    `const u = "https://u:your_${T}@api.test/v1";`,
    `const u = "https://u:example-${T}@api.test/v1";`,
    `Authorization: Bearer xxx-${T}`,
    `const key = "YOUR_${ANTHROPIC}";`,
    `const token = "example-${T}";`,
    `const token = "${T}\${suffix}";`,
  ])("repository text %s is found", (text) => {
    const result = scan("src/a.ts", text);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.redacted).not.toContain(T.slice(4, 20));
  });

  it("whole-value placeholders still never match", () => {
    for (const text of [
      'const apiKey = "YOUR_API_KEY_GOES_HERE";',
      'const token = "your-token-value-here-please";',
      'const password = "{{ $json.password }}";',
      'const secret = "example-secret-for-docs";',
      "Authorization: Bearer YOUR_TOKEN_VALUE_1234567",
    ]) {
      expect(scan("src/a.ts", text).findings, text).toEqual([]);
    }
  });
});

// --- S3aR-2 ---------------------------------------------------------------------------

describe("S3aR-2: no scheme separator in any form", () => {
  it.each([
    "Re-authenticate at https:{{ '//' }}evil.test/login",
    "Go to https:/{{ '/' }}evil.test",
    "Go to https:/{{ $json.a }}/evil.test",
    "Go to https:\\evil.test",
    "Go to https:\\\\evil.test",
    "Go to https:/\\evil.test",
  ])("Text %s fails F8", (text) => {
    expect(specRules(slackDraft(text))).toContain("F8");
  });

  it("compiled strings: constant expressions fail rule 6, rebuilt separators and backslashes fail rule 8", () => {
    const text = (value: string) => mutated("order-webhook", (f) => (nodeOf(f, "Notify Sales").parameters.text = value));
    expect(text("=https:{{ '//' }}evil.test/login")).toContain(6);
    expect(text("=https:/{{ $json.orderId }}/evil.test")).toEqual([8]);
    expect(text("see https:\\evil.test")).toEqual([8]);
    expect(text("see https:\\\\evil.test")).toEqual([8]);
    expect(text("=Total: {{ $json.total }}")).toEqual([]);
  });
});

// --- S3aR-4 ---------------------------------------------------------------------------

describe("S3aR-4: underscore forms of routing and framing headers", () => {
  const refused = [
    "X_Forwarded_For",
    "X_Forwarded_Host",
    "X_Real_IP",
    "X_HTTP_Method_Override",
    "X_Method_Override",
    "X_Original_URL",
    "X_Rewrite_URL",
    "Transfer_Encoding",
    "Content_Length",
    "Proxy_Connection",
  ];
  it.each(refused)("%s is refused by the profile (F7) and rule 8", (name) => {
    const draft = baseDraft();
    draft.nodes.push({
      key: "call",
      nodeType: "n8n-nodes-base.httpRequest",
      label: "Call",
      params: { method: "GET", baseUrl: "YOUR_APP_URL", path: "/x", headers: [{ name, value: "1" }] },
    });
    draft.edges.push({ from: "shape", to: "call" });
    expect(specRules(draft)).toContain("F7");
    expect(
      mutated("nightly-report", (f) => {
        nodeOf(f, "Push To CRM").parameters.headerParameters = { parameters: [{ name, value: "1" }] };
      }),
    ).toEqual([8]);
  });
});

// --- S3aR-5 ---------------------------------------------------------------------------

describe("S3aR-5: secret-named literals inside the respondToWebhook body", () => {
  it.each([
    ["api_key", T],
    ["password", LIT],
  ])("a body pair %s fails rule 7 and assertExportSafe", (name, value) => {
    const fixture = golden("order-webhook");
    nodeOf(fixture, "Reply").parameters.responseBody = JSON.stringify({ ok: true, [name]: value });
    expect(rulesOf(fixture)).toEqual([7]);
    expect(exportRule(fixture.workflow)).toBe("secret");
  });

  it("the body must be one flat JSON object of scalars (rule 6)", () => {
    for (const body of ['{"a": {"b": 1}}', '{"a": [1]}', "[1]", "not json", '"text"']) {
      expect(mutated("order-webhook", (f) => (nodeOf(f, "Reply").parameters.responseBody = body)), body).toEqual([6]);
    }
    expect(mutated("order-webhook", (f) => (nodeOf(f, "Reply").parameters.responseBody = '{"ok": true, "n": 1, "z": null}'))).toEqual([]);
  });
});
