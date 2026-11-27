// @vitest-environment node
/**
 * Phase 3a review fixes (contract section 11 "Phase 3a review fixes", backend
 * items 2-8; D-49..D-53). Each block fails when its rule is removed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compileFlow, type N8nWorkflow } from "@/lib/compiler";
import { checkFlowSpec, computeRequiredCredentials, type FlowSpecRule } from "@/lib/flowspec";
import { fieldNameSchema, fieldPathSchema, identSchema } from "@/lib/flowspec/values";
import { NODE_PROFILES } from "@/lib/n8n-catalog/profiles";
import { renderForScan } from "@/lib/security/scan-render";
import { ALLOWED_PARAMS } from "@/lib/validator/allowed-params";
import { assertExportSafe, ExportNotSafeError, validateWorkflow, type ValidatorRule } from "@/lib/validator";
import type { JsonValue, SetupChecklist } from "@/schemas/flow";
import { flowSpecDraftSchema, type FlowSpecDraft } from "@/schemas/flowspec";

import { baseDraft, clone, compileSpec, goldenPath, loadDraft, SPEC_NAMES } from "../flow/helpers";

/** Runtime-built values so no secret-shaped literal sits in the repo. */
const R = (n: number, alphabet = "aZ3kQ9xLmP2vW7tR5yB8nC4dF6gH1jK0") =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
/** A 30-character high-entropy literal (entropy well above 3.5). */
const LIT = R(30);
const T = "9fK2mQ7xL4pR8vT1nB6cY3wZ5hJ0dS2a";
const PLANTED_KEY = "sk-ant-" + "api03-" + R(40);

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

function rulesOf(workflow: unknown, checklist: unknown): ValidatorRule[] {
  const result = validateWorkflow(workflow, checklist);
  return result.ok ? [] : result.errors.map((error) => error.rule);
}

function mutated(name: string, mutate: (fixture: Fixture) => void): ValidatorRule[] {
  const fixture = golden(name);
  mutate(fixture);
  return rulesOf(fixture.workflow, fixture.checklist);
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

/** Compiles without checkFlowSpec, so a draft that fails F9 can still reach the validator. */
function compileUnchecked(draft: FlowSpecDraft) {
  return compileFlow({ ...draft, requiredCredentials: computeRequiredCredentials(draft.nodes) });
}

function validatorRules(draft: FlowSpecDraft): ValidatorRule[] {
  const { workflow, checklist } = compileUnchecked(draft);
  return rulesOf(workflow, checklist);
}

/** baseDraft + one node after "shape". */
function withNode(node: FlowSpecDraft["nodes"][number]): FlowSpecDraft {
  const draft = baseDraft();
  draft.nodes.push(node);
  draft.edges.push({ from: "shape", to: node.key });
  return draft;
}

const postgresInsert = (columns: { name: string; value: JsonValue }[]) =>
  withNode({
    key: "save",
    nodeType: "n8n-nodes-base.postgres",
    label: "Save",
    params: { operation: "insert", table: "users", columns },
  });

const supabaseInsert = (columns: { name: string; value: JsonValue }[]) =>
  withNode({
    key: "save",
    nodeType: "n8n-nodes-base.supabase",
    label: "Save",
    params: { operation: "insert", table: "users", columns },
  });

const slack = (text: string) =>
  withNode({
    key: "post",
    nodeType: "n8n-nodes-base.slack",
    label: "Post",
    params: { channel: "YOUR_SLACK_CHANNEL", text },
  });

const http = (params: Record<string, JsonValue>) =>
  withNode({
    key: "call",
    nodeType: "n8n-nodes-base.httpRequest",
    label: "Call",
    params: { method: "POST", baseUrl: "YOUR_APP_URL", path: "/hooks", ...params },
  });

// --- item 2: shared scan rendering --------------------------------------------------

describe("item 2: one scan rendering for F9, rule 7, and assertExportSafe (D-49)", () => {
  it("a postgres column `password` with a 30-character literal fails F9 and rule 7", () => {
    const draft = postgresInsert([{ name: "password", value: LIT }]);
    expect(specRules(draft)).toContain("F9");
    expect(validatorRules(draft)).toContain(7);
  });

  it("a supabase column `api_key` with a literal fails F9 and rule 7", () => {
    const draft = supabaseInsert([{ name: "api_key", value: LIT }]);
    expect(specRules(draft)).toContain("F9");
    expect(validatorRules(draft)).toContain(7);
  });

  it("a set field named `api_key` with a literal fails F9 and rule 7", () => {
    const draft = baseDraft();
    draft.nodes[1]!.params = { fields: [{ name: "api_key", value: LIT }], keepOtherFields: true };
    expect(specRules(draft)).toEqual(["F9"]);
    expect(validatorRules(draft)).toEqual([7]);
  });

  it("an httpRequest header pair { name: apikey, value: T } fails rule 7", () => {
    expect(
      mutated("nightly-report", (f) => {
        nodeOf(f, "Push To CRM").parameters.headerParameters = { parameters: [{ name: "apikey", value: T }] };
      }),
    ).toContain(7);
  });

  it("a supabase { fieldId: api_key, fieldValue: T } fails rule 7", () => {
    expect(
      mutated("lead-import", (f) => {
        nodeOf(f, "Mirror Lead").parameters.fieldsUi = { fieldValues: [{ fieldId: "api_key", fieldValue: T }] };
      }),
    ).toEqual([7]);
  });

  it("S3a-1: a Bearer credential in a compiled value fails rule 7 and assertExportSafe", () => {
    const fixture = golden("order-webhook");
    const assignments = (nodeOf(fixture, "Shape Order").parameters.assignments as { assignments: { value: JsonValue }[] })
      .assignments;
    assignments[0]!.value = `Bearer ${T}`;
    expect(rulesOf(fixture.workflow, fixture.checklist)).toEqual([7]);
    expect(exportRule(fixture.workflow)).toBe("secret");
  });

  it("secret-named columns with expression values pass F9 and rule 7", () => {
    const draft = postgresInsert([
      { name: "password", value: "{{ $json.password }}" },
      { name: "api_key", value: "{{ $json.apiKey }}" },
    ]);
    expect(specRules(draft)).toEqual([]);
    expect(validatorRules(draft)).toEqual([]);
    const supabase = supabaseInsert([{ name: "auth_token", value: "{{ $json.token }}" }]);
    expect(specRules(supabase)).toEqual([]);
    expect(validatorRules(supabase)).toEqual([]);
  });

  it("every conformance pair, renamed `password` with the literal: F9 fails whenever rule 7 fails", () => {
    let pairs = 0;
    let compiled = 0;
    for (const name of SPEC_NAMES) {
      const original = loadDraft(name);
      original.nodes.forEach((node, nodeIndex) => {
        const locations: string[][] = [];
        const stack: { value: unknown; path: string[] }[] = [{ value: node.params, path: [] }];
        while (stack.length > 0) {
          const { value, path } = stack.pop()!;
          if (Array.isArray(value)) value.forEach((child, i) => stack.push({ value: child, path: [...path, String(i)] }));
          else if (value !== null && typeof value === "object") {
            const record = value as Record<string, unknown>;
            if (typeof record.name === "string" && "value" in record) locations.push(path);
            for (const [key, child] of Object.entries(record)) stack.push({ value: child, path: [...path, key] });
          }
        }
        for (const path of locations) {
          pairs += 1;
          const draft = clone(original);
          let target: unknown = draft.nodes[nodeIndex]!.params;
          for (const part of path) target = (target as Record<string, unknown>)[part];
          Object.assign(target as Record<string, unknown>, { name: "password", value: LIT });
          const f9 = specRules(draft).includes("F9");
          let rule7 = false;
          try {
            rule7 = validatorRules(draft).includes(7);
            compiled += 1;
          } catch {
            // Params invalid for the profile (for example a header named password): compile refuses.
          }
          if (rule7) expect(f9, `${name} ${node.key} ${path.join(".")}`).toBe(true);
          expect(f9, `${name} ${node.key} ${path.join(".")}`).toBe(true);
        }
      });
    }
    expect(pairs).toBeGreaterThan(5);
    expect(compiled).toBeGreaterThan(3);
  });

  it("S3a-2 probes: a planted key next to currentKey / newKey, and under __proto__", () => {
    const fixture = golden("tag-sync");
    nodeOf(fixture, "Rename Tag").parameters.keys = { key: [{ from: PLANTED_KEY, currentKey: "a", newKey: "b" }] };
    expect(rulesOf(fixture.workflow, fixture.checklist)).toContain(7);
    expect(exportRule(fixture.workflow)).toBe("secret");

    const proto = golden("tag-sync");
    const text = JSON.stringify(proto.workflow).replace(
      '"keys":{"key":',
      `"keys":{"__proto__":{"x":"${PLANTED_KEY}"},"key":`,
    );
    const hostile = JSON.parse(text) as unknown;
    expect(text).toContain("__proto__");
    expect(validateWorkflow(hostile, proto.checklist).ok).toBe(false);
    expect(exportRule(hostile)).toBe("shape");
  });

  it("a long node key and renameKeys identifiers the generic rule would misread still pass", () => {
    const draft = baseDraft();
    draft.nodes[1]!.key = "customer_api_key_lookup_handler_2";
    draft.edges[0]!.to = "customer_api_key_lookup_handler_2";
    draft.tests.cases[0]!.expect.reachedNodes = ["start", "customer_api_key_lookup_handler_2"];
    draft.nodes.push({
      key: "rename",
      nodeType: "n8n-nodes-base.renameKeys",
      label: "Rename",
      params: { keys: [{ from: "customer.billing.apiKeyReference2x", to: "billing_api_key_ref9" }] },
    });
    draft.edges.push({ from: "customer_api_key_lookup_handler_2", to: "rename" });
    expect(specRules(draft)).toEqual([]);
    const { workflow, checklist } = compileUnchecked(draft);
    expect(rulesOf(workflow, checklist)).toEqual([]);
    expect(exportRule(workflow)).toBeNull();
  });

  it("renders one line per leaf and per pair; renames only the two exact positions", () => {
    const text = renderForScan({
      nodes: [
        { key: "abc", params: { key: "kept", list: ["x", 1] } },
        { type: "n8n-nodes-base.renameKeys", parameters: { keys: { key: [{ currentKey: "a.b", newKey: "c" }] } } },
        { type: "n8n-nodes-base.set", parameters: { keys: { key: [{ currentKey: "d" }] } } },
      ],
      pair: { name: "api_key", value: "v" },
      field: { fieldId: "token", fieldValue: 3 },
    });
    expect(text.split("\n")).toEqual([
      '"node": "abc"',
      '"key": "kept"',
      '"list": "x"',
      '"list": 1',
      '"type": "n8n-nodes-base.renameKeys"',
      '"from": "a.b"',
      '"to": "c"',
      '"type": "n8n-nodes-base.set"',
      '"currentKey": "d"',
      '"api_key": "v"',
      '"name": "api_key"',
      '"value": "v"',
      '"token": 3',
      '"fieldId": "token"',
      '"fieldValue": 3',
    ]);
  });
});

// --- item 3: reserved names ---------------------------------------------------------

describe("item 3: reserved names (D-49)", () => {
  const RESERVED = ["__proto__", "constructor", "prototype"];

  it.each(RESERVED)("%s is refused by FieldName, every FieldPath part, and Ident", (name) => {
    expect(fieldNameSchema.safeParse(name).success).toBe(false);
    expect(fieldPathSchema.safeParse(name).success).toBe(false);
    expect(fieldPathSchema.safeParse(`a.${name}`).success).toBe(false);
    expect(fieldPathSchema.safeParse(`${name}.b.c`).success).toBe(false);
    expect(identSchema.safeParse(name).success).toBe(false);
    // Similar non-reserved names stay valid.
    expect(fieldNameSchema.safeParse(`${name}_x`).success).toBe(true);
  });

  it("a postgres column named __proto__ fails F7", () => {
    expect(specRules(postgresInsert([{ name: "__proto__", value: "x" }]))).toContain("F7");
  });

  it("a column list of 20 compiles to 20 own properties in `value`", () => {
    const columns = Array.from({ length: 20 }, (_, i) => ({ name: `col_${i}`, value: `v${i}` }));
    const draft = postgresInsert(columns);
    expect(specRules(draft)).toEqual([]);
    const save = compileUnchecked(draft).workflow.nodes.find((node) => node.name === "Save");
    const value = (save?.parameters.columns as Record<string, JsonValue>).value as Record<string, JsonValue>;
    expect(Object.keys(value)).toHaveLength(20);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it.each(RESERVED)("validator rule 1 and assertExportSafe refuse a %s key at any depth", (name) => {
    const fixture = golden("order-webhook");
    const text = JSON.stringify(fixture.workflow).replace('"otherOptions":{}', `"otherOptions":{"${name}":{"a":1}}`);
    const hostile = JSON.parse(text) as unknown;
    expect(text).toContain(name);
    expect(rulesOf(hostile, fixture.checklist)).toEqual([1]);
    expect(exportRule(hostile)).toBe("shape");
  });
});

// --- item 4: validator independence --------------------------------------------------

describe("item 4: the validator's own parameter table (D-50)", () => {
  it("rejects SQL, deletes, literal recipients, bcc, proxy, raw JSON bodies, and unlisted catalog parameters", () => {
    const cases: [string, (f: Fixture) => void][] = [
      [
        "postgres executeQuery",
        (f) => {
          const p = nodeOf(f, "Insert Lead").parameters;
          p.operation = "executeQuery";
          p.query = "DROP TABLE leads";
        },
      ],
      ["postgres deleteTable", (f) => (nodeOf(f, "Insert Lead").parameters.operation = "deleteTable")],
      ["supabase delete", (f) => (nodeOf(f, "Mirror Lead").parameters.operation = "delete")],
    ];
    for (const [label, mutate] of cases) expect(mutated("lead-import", mutate), label).toContain(5);

    expect(mutated("order-webhook", (f) => (nodeOf(f, "Email Team").parameters.toEmail = "boss@example.com"))).toEqual([8]);
    expect(
      mutated("order-webhook", (f) => (nodeOf(f, "Email Team").parameters.options = { bccEmail: "YOUR_TEAM_EMAIL" })),
    ).toEqual([5]);
    expect(
      mutated("nightly-report", (f) => {
        nodeOf(f, "Push To CRM").parameters.options = { proxy: "10.0.0.1:8080", allowUnauthorizedCerts: true };
      }),
    ).toEqual([5]);
    expect(
      mutated("nightly-report", (f) => {
        const p = nodeOf(f, "Push To CRM").parameters;
        p.specifyBody = "json";
        p.jsonBody = '{"a": 1}';
      }),
    ).toEqual([5]);
    // `continueOnFail`-style catalog parameter the profiles never emit (exists in the catalog).
    expect(mutated("order-webhook", (f) => (nodeOf(f, "Notify Sales").parameters.authentication = "accessToken"))).toEqual([5]);
  });

  it("every destination is exactly one YOUR_… token", () => {
    for (const value of ["YOUR_SLACK_CHANNEL YOUR_OTHER", "general", "=YOUR_SLACK_CHANNEL", "{{ $json.c }}"]) {
      expect(
        mutated("order-webhook", (f) => (nodeOf(f, "Notify Sales").parameters.channelId = { __rl: true, mode: "id", value })),
        value,
      ).toContain(8);
    }
    expect(mutated("support-triage", (f) => (nodeOf(f, "Alert On Call").parameters.chatId = "12345"))).toEqual([8]);
    expect(mutated("support-triage", (f) => delete nodeOf(f, "Open Issue").parameters.owner)).toEqual([8]);
  });

  it("assertExportSafe refuses an added code node (rule type)", () => {
    const fixture = golden("order-webhook");
    fixture.workflow.nodes.push({
      id: "00000000-0000-4000-8000-000000000000",
      name: "Run Code",
      type: "n8n-nodes-base.code" as N8nWorkflow["nodes"][number]["type"],
      typeVersion: 2,
      position: [0, 0],
      parameters: { jsCode: "return []" },
    });
    expect(exportRule(fixture.workflow)).toBe("type");
    const other = golden("order-webhook");
    nodeOf(other, "Reply").type = "n8n-nodes-base.redis" as N8nWorkflow["nodes"][number]["type"];
    expect(exportRule(other.workflow)).toBe("type");
  });

  it("table invariant: no delete / update / execute operations and no forbidden parameter names", () => {
    const forbiddenOperation = /delete|remove|clear|update|upsert|execute/i;
    // The one documented exception: removeDuplicates deduplicates the current items in memory (requests.md).
    const exempt = (type: string, value: unknown) =>
      type === "n8n-nodes-base.removeDuplicates" && value === "removeDuplicateInputItems";
    const forbiddenNames = [
      "query",
      "jsonQuery",
      "jsonHeaders",
      "jsonBody",
      "proxy",
      "allowUnauthorizedCerts",
      "ccEmail",
      "bccEmail",
      "jsCode",
      "functionCode",
      "command",
    ];
    for (const [type, table] of Object.entries(ALLOWED_PARAMS)) {
      for (const value of table.modes.operation ?? []) {
        if (!exempt(type, value)) expect(forbiddenOperation.test(String(value)), `${type} ${String(value)}`).toBe(false);
      }
      const names = [...table.names, ...Object.values(table.containers).flat()];
      for (const name of forbiddenNames) expect(names, type).not.toContain(name);
    }
    expect(Object.keys(ALLOWED_PARAMS).sort()).toEqual(Object.keys(NODE_PROFILES).sort());
  });
});

// --- item 5: no `://` and the path warning --------------------------------------------

describe("item 5: no :// in a Text or a compiled parameter (D-51)", () => {
  it("S3a-6 probes fail F8 (FlowSpec) and rule 8 (compiled)", () => {
    const drafts: [string, FlowSpecDraft][] = [
      ["redirect path", http({ path: "/redirect?to=https://evil.test/" })],
      ["file link", slack("see file:///etc/passwd")],
      ["body value", http({ jsonBody: [{ name: "callback", value: "https://evil.test/cb" }] })],
      ["slack link", slack("Click HTTPS://evil.test/login now")],
    ];
    for (const [label, draft] of drafts) expect(specRules(draft), label).toContain("F8");

    expect(
      mutated("nightly-report", (f) => {
        nodeOf(f, "Push To CRM").parameters.url = "=YOUR_CRM_API_URL/redirect?to=https://evil.test/{{ $json.id }}";
      }),
    ).toEqual([8]);
    expect(mutated("order-webhook", (f) => (nodeOf(f, "Notify Sales").parameters.text = "see file:///etc/passwd"))).toEqual([8]);
    expect(
      mutated("nightly-report", (f) => {
        nodeOf(f, "Push To CRM").parameters.bodyParameters = { parameters: [{ name: "callback", value: "https://evil.test/cb" }] };
      }),
    ).toEqual([8]);
    expect(
      mutated("order-webhook", (f) => (nodeOf(f, "Notify Sales").parameters.text = "Click HTTPS://evil.test/login now")),
    ).toEqual([8]);
  });

  it("a placeholder link in a Slack text passes both layers", () => {
    const draft = slack("Order: YOUR_APP_URL/orders/{{ $json.id }}");
    expect(specRules(draft)).toEqual([]);
    expect(validatorRules(draft)).toEqual([]);
  });

  it("rule 8 refuses :// in any parameter string of a golden", () => {
    expect(mutated("support-triage", (f) => (nodeOf(f, "Open Issue").parameters.body = "see ftp://x.test/a"))).toEqual([8]);
  });

  it("the HTTP path warning appears only when the path holds an expression", () => {
    const warning =
      "An HTTP Request node builds its URL path from incoming data. Make sure callers cannot reach endpoints they should not.";
    expect(compileUnchecked(http({ path: "/orders/{{ $json.id }}" })).checklist.warnings).toContain(warning);
    expect(compileUnchecked(http({ path: "/orders" })).checklist.warnings).not.toContain(warning);
  });
});

// --- item 6: header names ---------------------------------------------------------

describe("item 6: header names (D-51, OQ-28)", () => {
  const refused = ["Host", "apikey", "X_API_KEY", "Authentication", "X_Auth_Token", "Session_Id", "Connection"];
  it.each(refused)("%s is refused by the profile (F7) and validator rule 8", (name) => {
    expect(specRules(http({ headers: [{ name, value: "x" }] }))).toContain("F7");
    expect(
      mutated("nightly-report", (f) => {
        nodeOf(f, "Push To CRM").parameters.headerParameters = { parameters: [{ name, value: "x" }] };
      }),
    ).toEqual([8]);
  });

  it.each(["Accept", "X_Request_Id"])("%s is accepted by both layers", (name) => {
    const draft = http({ headers: [{ name, value: "application/json" }] });
    expect(specRules(draft)).toEqual([]);
    expect(validatorRules(draft)).toEqual([]);
  });
});

// --- item 7: respondToWebhook literals ------------------------------------------------

describe("item 7: respondToWebhook bodies are literal (D-52)", () => {
  it("a {{ in a body value fails F7", () => {
    const draft = loadDraft("order-webhook");
    const reply = draft.nodes.find((node) => node.nodeType === "n8n-nodes-base.respondToWebhook")!;
    reply.params = { statusCode: 200, body: [{ name: "id", value: "{{ $json.id }}" }] };
    expect(specRules(draft)).toEqual(["F7"]);
  });

  it("validator rule 6 refuses a respondToWebhook body that holds {{", () => {
    expect(
      mutated("order-webhook", (f) => (nodeOf(f, "Reply").parameters.responseBody = '={"id": "{{ $json.id }}"}')),
    ).toEqual([6]);
  });
});

// --- item 8: flow name and description -------------------------------------------------

describe("item 8: flow name and description are display text (D-53)", () => {
  it.each(["=Order flow", "Order {{ $json.x }} flow"])("FlowSpec name %s fails the schema", (name) => {
    expect(flowSpecDraftSchema.safeParse({ ...baseDraft(), name }).success).toBe(false);
    expect(flowSpecDraftSchema.safeParse({ ...baseDraft(), description: `${name} described here` }).success).toBe(false);
  });

  it("a plain name still passes", () => {
    expect(flowSpecDraftSchema.safeParse({ ...baseDraft(), name: "Orders = money" }).success).toBe(true);
  });

  it.each(["={{ $json.name }}", "=Flow", "Flow {{ $json.a }}"])("validator rule 6 refuses workflow name %s", (name) => {
    expect(mutated("order-webhook", (f) => (f.workflow.name = name))).toEqual([6]);
  });
});
