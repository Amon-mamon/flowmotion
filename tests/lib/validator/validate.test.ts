// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { N8nWorkflow } from "@/lib/compiler";
import { NODE_CATALOG } from "@/lib/n8n-catalog/catalog";
import { assertExportSafe, ExportNotSafeError, validateWorkflow, type ValidatorRule } from "@/lib/validator";
import type { SetupChecklist } from "@/schemas/flow";

import { clone, compileSpec, goldenPath, SPEC_NAMES } from "../flow/helpers";

/** A planted key built at runtime so no secret-shaped literal sits in the repo. */
const R = (n: number, alphabet = "aZ3kQ9xLmP2vW7tR5yB8nC4dF6gH1jK0") =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const PLANTED_KEY = "sk-ant-" + "api03-" + R(40);

interface Fixture {
  workflow: N8nWorkflow;
  checklist: SetupChecklist;
}

/** A golden export read from disk, with the checklist the compiler builds for it. */
function golden(name: string): Fixture {
  const workflow = JSON.parse(readFileSync(goldenPath(name), "utf8")) as N8nWorkflow;
  return { workflow, checklist: clone(compileSpec(name).checklist) };
}

function rulesOf(fixture: { workflow: unknown; checklist: unknown }): ValidatorRule[] {
  const result = validateWorkflow(fixture.workflow, fixture.checklist);
  return result.ok ? [] : result.errors.map((error) => error.rule);
}

function node(fixture: Fixture, name: string) {
  const found = fixture.workflow.nodes.find((item) => item.name === name);
  if (found === undefined) throw new Error(`No node ${name}`);
  return found;
}

/** Mutates a golden and returns the rules that fail. */
function mutated(name: string, mutate: (fixture: Fixture) => void): ValidatorRule[] {
  const fixture = golden(name);
  mutate(fixture);
  return rulesOf(fixture);
}

describe("validator: every golden passes", () => {
  it.each(SPEC_NAMES)("%s", (name) => {
    expect(validateWorkflow(golden(name).workflow, golden(name).checklist)).toEqual({ ok: true });
    const compiled = compileSpec(name);
    expect(validateWorkflow(compiled.workflow, compiled.checklist)).toEqual({ ok: true });
  });
});

describe("validator: one failing case per rule (testing.md)", () => {
  it("rule 1: shape", () => {
    expect(mutated("order-webhook", (f) => ((f.workflow as unknown as Record<string, unknown>).active = true))).toEqual([1]);
    expect(mutated("order-webhook", (f) => ((f.workflow as unknown as Record<string, unknown>).pinData = {}))).toEqual([1]);
    expect(mutated("order-webhook", (f) => ((f.workflow.settings as Record<string, unknown>).executionOrder = "v0"))).toEqual([1]);
    expect(mutated("order-webhook", (f) => ((f.workflow.settings as Record<string, unknown>).errorWorkflow = "1"))).toEqual([1]);
    expect(mutated("order-webhook", (f) => ((node(f, "Reply") as unknown as Record<string, unknown>).disabled = true))).toEqual([1]);
    expect(mutated("order-webhook", (f) => ((node(f, "Reply") as unknown as Record<string, unknown>).position = [1]))).toEqual([1]);
    expect(
      mutated("order-webhook", (f) => {
        (f.workflow.connections["Order Webhook"]!.main[0]![0] as unknown as Record<string, unknown>).type = "ai_tool";
      }),
    ).toEqual([1]);
    expect(rulesOf({ workflow: null, checklist: golden("order-webhook").checklist })).toEqual([1]);
    expect(rulesOf({ workflow: "{}", checklist: golden("order-webhook").checklist })).toEqual([1]);
    expect(rulesOf({ workflow: { name: "x", nodes: [], connections: {}, settings: { executionOrder: "v1" } }, checklist: { credentials: [], placeholders: [], warnings: [] } })).toContain(1);
  });

  it("rule 2: duplicate name, connection to a missing node, index out of range", () => {
    expect(mutated("order-webhook", (f) => (node(f, "Email Team").name = "Notify Sales"))).toContain(2);
    expect(
      mutated("order-webhook", (f) => {
        f.workflow.connections["Join Branches"]!.main[0]![0]!.node = "Ghost";
      }),
    ).toContain(2);
    expect(
      mutated("order-webhook", (f) => {
        f.workflow.connections.Ghost = { main: [[{ node: "Reply", type: "main", index: 0 }]] };
      }),
    ).toEqual([2]);
    // IF has 2 outputs.
    expect(
      mutated("order-webhook", (f) => {
        f.workflow.connections["Large Order"]!.main.push([{ node: "Reply", type: "main", index: 0 }]);
      }),
    ).toEqual([2]);
    // Merge has 2 inputs.
    expect(
      mutated("order-webhook", (f) => {
        f.workflow.connections["Email Team"]!.main[0]![0]!.index = 2;
      }),
    ).toEqual([2]);
    // A one-input node only has input 0.
    expect(
      mutated("order-webhook", (f) => {
        f.workflow.connections["Join Branches"]!.main[0]![0]!.index = 1;
      }),
    ).toEqual([2]);
    // Switch: outputs = rules, plus one for the fallback.
    expect(
      mutated("support-triage", (f) => {
        f.workflow.connections["Route Priority"]!.main.push([{ node: "Ignore", type: "main", index: 0 }]);
      }),
    ).toEqual([2]);
    expect(mutated("support-triage", (f) => (node(f, "Route Priority").parameters.options = {}))).toEqual([2]);
    // stopAndError has no output.
    expect(
      mutated("tag-sync", (f) => {
        f.workflow.connections["Fail Empty"] = { main: [[{ node: "Each Tag", type: "main", index: 0 }]] };
      }),
    ).toEqual([2]);
  });

  it("rule 3: no trigger, two triggers, an orphan, a cycle", () => {
    expect(
      mutated("tag-sync", (f) => {
        const start = node(f, "Start");
        start.type = "n8n-nodes-base.noOp";
      }),
    ).toContain(3);
    expect(
      mutated("tag-sync", (f) => {
        f.workflow.nodes.push({ ...clone(node(f, "Start")), id: "second", name: "Second Start" });
        f.workflow.connections["Second Start"] = { main: [[{ node: "Load Signups", type: "main", index: 0 }]] };
      }),
    ).toEqual([3]);
    expect(
      mutated("nightly-report", (f) => {
        delete f.workflow.connections.Collect;
      }),
    ).toEqual([3]);
    expect(
      mutated("tag-sync", (f) => {
        f.workflow.connections["Log To Sheet"] = { main: [[{ node: "Each Tag", type: "main", index: 0 }]] };
      }),
    ).toEqual([3]);
    // An edge into the trigger is refused (a trigger has no input).
    expect(
      mutated("tag-sync", (f) => {
        f.workflow.connections["Log To Sheet"] = { main: [[{ node: "Start", type: "main", index: 0 }]] };
      }),
    ).toEqual([2, 3]);
    // Returning to splitInBatches from its "done" branch is a cycle, not a loop.
    expect(
      mutated("nightly-report", (f) => {
        f.workflow.connections["Mail Report"] = { main: [[{ node: "Each Batch", type: "main", index: 0 }]] };
      }),
    ).toEqual([3]);
  });

  it("rule 4: a non-catalog type, a wrong typeVersion", () => {
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").type = "n8n-nodes-base.redis"))).toEqual([4]);
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").typeVersion = 1))).toEqual([4]);
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").type = "n8n-nodes-base.Slack"))).toEqual([4]);
  });

  it("rule 5: an unknown parameter, an option value outside the catalog", () => {
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.madeUp = true))).toEqual([5]);
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.operation = "explode"))).toEqual([5]);
    expect(mutated("order-webhook", (f) => (node(f, "Order Webhook").parameters.responseMode = "sometimes"))).toEqual([5]);
    expect(mutated("nightly-report", (f) => (node(f, "Top Fifty").parameters.keep = ["firstItems"]))).toEqual([5]);
    // A real n8n parameter the profiles never emit is refused by the validator's own table (D-50).
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.authentication = "oAuth2"))).toEqual([5]);
    expect(NODE_CATALOG.nodes["n8n-nodes-base.slack"]?.properties.some((property) => property.name === "authentication")).toBe(true);
  });

  it("rule 6: expressions outside the subset", () => {
    for (const text of [
      "={{ $env.SECRET }}",
      "={{ $json.a.constructor() }}",
      "={{ $json.a + 1 }}",
      "={{ $execution.id }}",
      "=1+1",
      "=plain text",
      "={{ $json.a",
      "{{ $json.a }}",
      "= {{ {{ $json.a }} }}",
      '={{ $node["Ghost"].json.a }}',
      '={{ $node["Reply"].json.a }}',
    ]) {
      expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = text)), text).toEqual([6]);
    }
    // Nested values are checked as well.
    expect(
      mutated("order-webhook", (f) => {
        node(f, "Notify Sales").parameters.channelId = { __rl: true, mode: "id", value: "={{ $vars.channel }}" };
      }),
    ).toEqual([6, 8]); // also not a single YOUR_… destination token (D-50)
    // An upstream $node reference is fine.
    expect(
      mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = '={{ $node["Order Webhook"].json.body.id }}')),
    ).toEqual([]);
  });

  it("rule 7: a planted sk-ant- key, a credentials key", () => {
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = `key ${PLANTED_KEY}`))).toEqual([7]);
    expect(mutated("order-webhook", (f) => (f.workflow.name = `Flow ${PLANTED_KEY}`))).toEqual([7]);
    expect(
      mutated("order-webhook", (f) => {
        (node(f, "Notify Sales") as unknown as Record<string, unknown>).credentials = { slackApi: { id: "1", name: "Slack" } };
      }),
    ).toEqual([7]);
    expect(
      mutated("order-webhook", (f) => {
        node(f, "Notify Sales").parameters.otherOptions = { credentials: { id: "1" } };
      }),
    ).toEqual([5, 7]); // also an option key outside the validator's table (D-50)
  });

  it("rule 7: a planted key inside a renameKeys field is still found", () => {
    expect(
      mutated("tag-sync", (f) => {
        node(f, "Rename Tag").parameters.keys = { key: [{ currentKey: PLANTED_KEY, newKey: "tag" }] };
      }),
    ).toEqual([7]);
  });

  it("rule 8: a code node, an http:// URL, a literal HTTP origin, an auth header", () => {
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").type = "n8n-nodes-base.code"))).toEqual([4, 8]);
    for (const type of [
      "n8n-nodes-base.executeCommand",
      "n8n-nodes-base.ssh",
      "n8n-nodes-base.executeWorkflow",
      "n8n-nodes-base.slackTrigger",
      "@n8n/n8n-nodes-langchain.agent",
      "n8n-nodes-community.thing",
    ]) {
      expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").type = type)), type).toEqual(expect.arrayContaining([4, 8]));
    }
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = "see http://example.com/x"))).toEqual([8]);
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = "see HTTP://example.com/x"))).toEqual([8]);
    for (const url of [
      "https://api.example.com/v1/orders",
      "http://localhost:5678/x",
      "=https://api.example.com/{{ $json.id }}",
      "={{ $json.url }}",
      "=YOUR_CRM_API_URL.evil.example/x",
      "YOUR_CRM_HOST/x",
      "//evil.example/YOUR_CRM_API_URL",
      "",
    ]) {
      expect(mutated("nightly-report", (f) => (node(f, "Push To CRM").parameters.url = url)), url).toContain(8);
    }
    expect(mutated("nightly-report", (f) => delete node(f, "Push To CRM").parameters.url)).toEqual([8]);
    for (const name of ["Authorization", "authorization", "Proxy-Authorization", "Cookie", "X-API-Key", " x-api-key "]) {
      expect(
        mutated("nightly-report", (f) => {
          node(f, "Push To CRM").parameters.headerParameters = { parameters: [{ name, value: "x" }] };
        }),
        name,
      ).toEqual([8]);
    }
    expect(mutated("nightly-report", (f) => (node(f, "Push To CRM").parameters.authentication = "predefinedCredentialType"))).toContain(8);
    expect(mutated("nightly-report", (f) => (node(f, "Push To CRM").parameters.jsonHeaders = '{"X-Trace": "x"}'))).toEqual([5, 8]);
  });

  it("rule 9: a YOUR_X placeholder missing from the checklist", () => {
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = "Ping YOUR_ONCALL_NAME"))).toEqual([9]);
    expect(
      mutated("order-webhook", (f) => {
        f.checklist.placeholders = f.checklist.placeholders.filter((item) => item.name !== "YOUR_SLACK_CHANNEL");
      }),
    ).toEqual([9]);
    expect(rulesOf({ workflow: golden("order-webhook").workflow, checklist: null })).toEqual([9]);
    expect(rulesOf({ workflow: golden("order-webhook").workflow, checklist: { placeholders: "all" } })).toEqual([9]);
  });

  it("rule 10: 41 nodes, more than 256 KB", () => {
    expect(
      mutated("tag-sync", (f) => {
        let previous = "Log To Sheet";
        while (f.workflow.nodes.length < 41) {
          const index = f.workflow.nodes.length;
          const name = `Extra ${index}`;
          f.workflow.nodes.push({
            id: `extra-${index}`,
            name,
            type: "n8n-nodes-base.noOp",
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          });
          f.workflow.connections[previous] = { main: [[{ node: name, type: "main", index: 0 }]] };
          previous = name;
        }
      }),
    ).toEqual([10]);
    expect(mutated("order-webhook", (f) => (node(f, "Notify Sales").parameters.text = "a".repeat(257 * 1024)))).toEqual([10]);
  });

  it("reports the node name and the rule only, sorted by rule", () => {
    const fixture = golden("order-webhook");
    node(fixture, "Notify Sales").parameters.text = "={{ $env.A }}";
    node(fixture, "Email Team").parameters.madeUp = 1;
    expect(validateWorkflow(fixture.workflow, fixture.checklist)).toEqual({
      ok: false,
      errors: [
        { rule: 5, nodeName: "Email Team" },
        { rule: 6, nodeName: "Notify Sales" },
      ],
    });
  });

  it("does not overflow the stack on deeply nested parameters", () => {
    const fixture = golden("order-webhook");
    let deep: unknown = "x";
    for (let index = 0; index < 50_000; index += 1) deep = [deep];
    (node(fixture, "Notify Sales").parameters as Record<string, unknown>).otherOptions = deep;
    expect(rulesOf(fixture)).toEqual([1]);
  });
});

describe("assertExportSafe (security.md section 9)", () => {
  it.each(SPEC_NAMES)("accepts golden %s", (name) => {
    expect(() => assertExportSafe(golden(name).workflow)).not.toThrow();
  });

  it("rejects a planted secret", () => {
    const fixture = golden("order-webhook");
    node(fixture, "Notify Sales").parameters.text = `token ${PLANTED_KEY}`;
    expect(() => assertExportSafe(fixture.workflow)).toThrow(ExportNotSafeError);
    try {
      assertExportSafe(fixture.workflow);
    } catch (error) {
      expect(error).toBeInstanceOf(ExportNotSafeError);
      expect((error as ExportNotSafeError).rule).toBe("secret");
      // The error never carries any part of the export.
      expect(String((error as Error).message)).not.toContain(PLANTED_KEY);
    }
  });

  it("rejects a credentials key, on a node or nested", () => {
    const onNode = golden("order-webhook");
    (node(onNode, "Notify Sales") as unknown as Record<string, unknown>).credentials = { slackApi: { id: "7" } };
    expect(() => assertExportSafe(onNode.workflow)).toThrow(expect.objectContaining({ rule: "credentials" }));
    const nested = golden("order-webhook");
    node(nested, "Notify Sales").parameters.otherOptions = { deep: [{ credentials: {} }] };
    expect(() => assertExportSafe(nested.workflow)).toThrow(expect.objectContaining({ rule: "credentials" }));
  });

  it("rejects an export over 256 KB and anything that is not a JSON object", () => {
    const big = golden("order-webhook");
    node(big, "Notify Sales").parameters.text = "a".repeat(257 * 1024);
    expect(() => assertExportSafe(big.workflow)).toThrow(expect.objectContaining({ rule: "size" }));
    for (const value of [null, undefined, "{}", 5, [], { when: new Date(0) }]) {
      expect(() => assertExportSafe(value)).toThrow(expect.objectContaining({ rule: "shape" }));
    }
  });
});
