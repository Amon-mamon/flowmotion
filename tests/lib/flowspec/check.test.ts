// @vitest-environment node
import { describe, expect, it } from "vitest";

import { compileFlow } from "@/lib/compiler";
import { checkFlowSpec, computeRequiredCredentials, type FlowSpecRule } from "@/lib/flowspec";
import { assertExportSafe, validateWorkflow } from "@/lib/validator";
import { flowSpecDraftSchema, flowSpecSchema, type FlowSpecDraft } from "@/schemas/flowspec";

import { baseDraft, loadDraft, SPEC_NAMES } from "../flow/helpers";

/** A planted key built at runtime so no secret-shaped literal sits in the repo. */
const R = (n: number, alphabet = "aZ3kQ9xLmP2vW7tR5yB8nC4dF6gH1jK0") =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const PLANTED_KEY = "sk-ant-" + "api03-" + R(40);

function rulesOf(draft: FlowSpecDraft): FlowSpecRule[] {
  const result = checkFlowSpec(draft);
  return result.ok ? [] : result.errors.map((error) => error.rule);
}

/** A webhook flow: webhook → if → (slack | noOp). */
function webhookDraft(): FlowSpecDraft {
  return {
    version: 1,
    name: "Webhook example",
    description: "A webhook flow used by the unit tests.",
    nodes: [
      {
        key: "hook",
        nodeType: "n8n-nodes-base.webhook",
        label: "Hook",
        params: { path: "hook", method: "POST", respond: "immediately" },
      },
      {
        key: "check",
        nodeType: "n8n-nodes-base.if",
        label: "Check",
        params: { conditions: [{ left: "{{ $json.body.ok }}", op: "isTrue" }], combine: "and" },
      },
      {
        key: "notify",
        nodeType: "n8n-nodes-base.slack",
        label: "Notify",
        params: { channel: "YOUR_SLACK_CHANNEL", text: "ok" },
      },
      { key: "skip", nodeType: "n8n-nodes-base.noOp", label: "Skip", params: {} },
    ],
    edges: [
      { from: "hook", to: "check" },
      { from: "check", to: "notify", output: 0 },
      { from: "check", to: "skip", output: 1 },
    ],
    tests: {
      cases: [
        {
          name: "ok",
          trigger: { kind: "webhook", payload: { body: { ok: true } } },
          mocks: { notify: { ok: true } },
          expect: { reachedNodes: ["hook", "check", "notify"], notReachedNodes: ["skip"] },
        },
      ],
    },
  };
}

describe("checkFlowSpec: passing cases", () => {
  it("accepts the base drafts and computes requiredCredentials", () => {
    const result = checkFlowSpec(baseDraft());
    expect(result).toMatchObject({ ok: true, spec: { requiredCredentials: [] } });
    const webhook = checkFlowSpec(webhookDraft());
    expect(webhook).toMatchObject({ ok: true, spec: { requiredCredentials: [{ type: "Slack", usedBy: ["notify"] }] } });
  });

  it.each(SPEC_NAMES)("conformance spec %s passes every rule", (name) => {
    const draft = loadDraft(name);
    const result = checkFlowSpec(draft);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(flowSpecSchema.safeParse(result.spec).success).toBe(true);
      expect(result.spec.requiredCredentials).toEqual(computeRequiredCredentials(draft.nodes));
    }
  });

  it("the conformance set covers both if outputs, a switch with fallback, a merge, and a splitInBatches loop", () => {
    const drafts = SPEC_NAMES.map(loadDraft);
    const edgesFrom = (type: string) =>
      drafts.flatMap((draft) => {
        const keys = new Set(draft.nodes.filter((node) => node.nodeType === type).map((node) => node.key));
        return draft.edges.filter((edge) => keys.has(edge.from));
      });
    expect(new Set(edgesFrom("n8n-nodes-base.if").map((edge) => edge.output ?? 0))).toEqual(new Set([0, 1]));
    const switches = drafts.flatMap((draft) => draft.nodes.filter((node) => node.nodeType === "n8n-nodes-base.switch"));
    expect(switches.some((node) => node.params.fallback === true)).toBe(true);
    const mergeInputs = drafts.flatMap((draft) => {
      const keys = new Set(draft.nodes.filter((node) => node.nodeType === "n8n-nodes-base.merge").map((node) => node.key));
      return draft.edges.filter((edge) => keys.has(edge.to)).map((edge) => edge.input ?? 0);
    });
    expect(new Set(mergeInputs)).toEqual(new Set([0, 1]));
    const loop = loadDraft("nightly-report");
    expect(loop.edges).toContainEqual({ from: "each_batch", to: "push_to_crm", output: 1 });
    expect(loop.edges).toContainEqual({ from: "pause", to: "each_batch" });
  });

  it("requiredCredentials are ordered by first use and list node keys", () => {
    expect(computeRequiredCredentials(loadDraft("order-webhook").nodes)).toEqual([
      { type: "Slack", usedBy: ["notify_slack"] },
      { type: "SMTP", usedBy: ["email_team"] },
    ]);
    // httpRequest has no fixed credential; gmail and googleSheets share "Google".
    expect(computeRequiredCredentials(loadDraft("nightly-report").nodes)).toEqual([
      { type: "Postgres", usedBy: ["load_orders"] },
      { type: "Google", usedBy: ["mail_report"] },
    ]);
  });
});

describe("checkFlowSpec: one failing case per rule", () => {
  it("F1: no nodes", () => {
    const draft = baseDraft();
    draft.nodes = [];
    draft.edges = [];
    expect(rulesOf(draft)).toContain("F1");
  });

  it("F1: 41 nodes", () => {
    const draft = baseDraft();
    for (let index = 0; index < 39; index += 1) {
      draft.nodes.push({ key: `n${index}`, nodeType: "n8n-nodes-base.noOp", label: `N ${index}`, params: {} });
      draft.edges.push({ from: index === 0 ? "shape" : `n${index - 1}`, to: `n${index}` });
    }
    expect(draft.nodes).toHaveLength(41);
    expect(rulesOf(draft)).toEqual(["F1"]);
    draft.nodes.pop();
    draft.edges.pop();
    expect(checkFlowSpec(draft).ok).toBe(true);
  });

  it("F1: duplicate key, and duplicate label ignoring case", () => {
    const sameKey = baseDraft();
    sameKey.nodes.push({ key: "shape", nodeType: "n8n-nodes-base.noOp", label: "Other", params: {} });
    expect(checkFlowSpec(sameKey)).toEqual({ ok: false, errors: [{ rule: "F1", nodeKey: "shape" }] });
    const sameLabel = baseDraft();
    sameLabel.nodes.push({ key: "other", nodeType: "n8n-nodes-base.noOp", label: "SHAPE", params: {} });
    sameLabel.edges.push({ from: "shape", to: "other" });
    expect(checkFlowSpec(sameLabel)).toEqual({ ok: false, errors: [{ rule: "F1", nodeKey: "other" }] });
  });

  it("F2: a node type outside the allowlist", () => {
    for (const type of ["n8n-nodes-base.code", "n8n-nodes-base.executeCommand", "@n8n/n8n-nodes-langchain.agent", "toString"]) {
      const draft = baseDraft();
      // The Zod schema already refuses this; the rule is the second line of defence.
      (draft.nodes[1] as { nodeType: string }).nodeType = type;
      expect(flowSpecDraftSchema.safeParse(draft).success, type).toBe(false);
      expect(checkFlowSpec(draft), type).toEqual({ ok: false, errors: [{ rule: "F2", nodeKey: "shape" }] });
    }
  });

  it("F3: no trigger, two triggers, and an edge into the trigger", () => {
    const none = baseDraft();
    none.nodes[0] = { key: "start", nodeType: "n8n-nodes-base.noOp", label: "Start", params: {} };
    expect(rulesOf(none)).toContain("F3");

    const two = baseDraft();
    two.nodes.push({ key: "again", nodeType: "n8n-nodes-base.scheduleTrigger", label: "Again", params: { cron: "0 * * * *" } });
    two.edges.push({ from: "again", to: "shape" });
    expect(rulesOf(two)).toContain("F3");

    const into = baseDraft();
    into.edges.push({ from: "shape", to: "start" });
    expect(checkFlowSpec(into)).toMatchObject({ ok: false });
    expect(rulesOf(into)).toContain("F3");
  });

  it("F4: unknown key, output or input out of range, duplicate edge", () => {
    const unknown = baseDraft();
    unknown.edges.push({ from: "shape", to: "ghost" });
    expect(rulesOf(unknown)).toEqual(["F4"]);

    const output = baseDraft();
    output.edges = [{ from: "start", to: "shape", output: 1 }];
    expect(rulesOf(output)).toContain("F4");

    const input = baseDraft();
    input.edges = [{ from: "start", to: "shape", input: 1 }];
    expect(rulesOf(input)).toContain("F4");

    const duplicate = baseDraft();
    duplicate.edges.push({ from: "start", to: "shape", output: 0, input: 0 });
    expect(rulesOf(duplicate)).toEqual(["F4"]);

    // switch: number of cases, plus 1 with fallback.
    const switched = loadDraft("support-triage");
    switched.edges.push({ from: "route_priority", to: "ignore", output: 4 });
    expect(rulesOf(switched)).toEqual(["F4"]);
    const noFallback = loadDraft("support-triage");
    const route = noFallback.nodes.find((node) => node.key === "route_priority");
    if (route !== undefined) route.params = { ...route.params, fallback: false };
    expect(rulesOf(noFallback)).toEqual(["F4"]);

    // merge has two inputs; stopAndError has no output.
    const merge = loadDraft("order-webhook");
    merge.edges.push({ from: "shape_order", to: "join_branches", input: 2 });
    expect(rulesOf(merge)).toEqual(["F4"]);
    const stop = loadDraft("tag-sync");
    stop.edges.push({ from: "fail_empty", to: "each_tag" });
    expect(rulesOf(stop)).toEqual(["F4"]);
  });

  it("F5: a node that the trigger does not reach", () => {
    const draft = baseDraft();
    draft.nodes.push({ key: "island", nodeType: "n8n-nodes-base.noOp", label: "Island", params: {} });
    expect(checkFlowSpec(draft)).toEqual({ ok: false, errors: [{ rule: "F5", nodeKey: "island" }] });
  });

  it("F6: a cycle that is not a splitInBatches loop", () => {
    const draft = baseDraft();
    draft.nodes.push({ key: "again", nodeType: "n8n-nodes-base.noOp", label: "Again", params: {} });
    draft.edges.push({ from: "shape", to: "again" }, { from: "again", to: "shape" });
    expect(rulesOf(draft)).toEqual(["F6"]);

    // Returning to splitInBatches from its "done" branch is not a loop.
    const done = loadDraft("nightly-report");
    done.edges.push({ from: "collect", to: "each_batch" });
    expect(rulesOf(done)).toEqual(["F6"]);

    // A self-edge is a cycle too.
    const self = baseDraft();
    self.edges.push({ from: "shape", to: "shape" });
    expect(rulesOf(self)).toEqual(["F6"]);
  });

  it("F7: params that do not match the node profile", () => {
    const unknownKey = baseDraft();
    unknownKey.nodes[1] = { ...baseDraft().nodes[1]!, params: { fields: [{ name: "a", value: 1 }], keepOtherFields: true, mode: "raw" } };
    expect(checkFlowSpec(unknownKey)).toEqual({ ok: false, errors: [{ rule: "F7", nodeKey: "shape" }] });

    const literalDestination = webhookDraft();
    literalDestination.nodes[2] = { ...literalDestination.nodes[2]!, params: { channel: "#general", text: "ok" } };
    expect(checkFlowSpec(literalDestination)).toEqual({ ok: false, errors: [{ rule: "F7", nodeKey: "notify" }] });
  });

  it("F8: a text outside the text and expression rules", () => {
    for (const value of ["={{ $json.a }}", "{{ $json.a.toString() }}", "{{ $env.SECRET }}", "{{ $json.a", "a\tb"]) {
      const draft = baseDraft();
      draft.nodes[1] = { ...draft.nodes[1]!, params: { fields: [{ name: "a", value }], keepOtherFields: true } };
      expect(checkFlowSpec(draft), value).toEqual({ ok: false, errors: [{ rule: "F8", nodeKey: "shape" }] });
    }
  });

  it("F8: $node must name the label of an upstream node", () => {
    const params = (label: string) => ({ channel: "YOUR_SLACK_CHANNEL", text: `{{ $node["${label}"].json.body.id }}` });
    const upstream = webhookDraft();
    upstream.nodes[2] = { ...upstream.nodes[2]!, params: params("Hook") };
    expect(checkFlowSpec(upstream).ok).toBe(true);

    for (const label of ["Skip", "Nobody", "Notify", "hook"]) {
      const draft = webhookDraft();
      draft.nodes[2] = { ...draft.nodes[2]!, params: params(label) };
      expect(checkFlowSpec(draft), label).toEqual({ ok: false, errors: [{ rule: "F8", nodeKey: "notify" }] });
    }
  });

  it("F9: a secret anywhere in the draft", () => {
    const inParams = webhookDraft();
    inParams.nodes[2] = { ...inParams.nodes[2]!, params: { channel: "YOUR_SLACK_CHANNEL", text: `key ${PLANTED_KEY}` } };
    expect(rulesOf(inParams)).toEqual(["F9"]);

    const inNotes = baseDraft();
    inNotes.nodes[1] = { ...inNotes.nodes[1]!, notes: `token: ${PLANTED_KEY}` };
    expect(rulesOf(inNotes)).toEqual(["F9"]);

    const inTests = baseDraft();
    inTests.tests.cases[0]!.trigger.payload = { apiKey: PLANTED_KEY };
    expect(rulesOf(inTests)).toEqual(["F9"]);
  });

  it("F9: long node keys and field paths are not mistaken for secrets", () => {
    const draft = baseDraft();
    const longKey = "notify_sales_team_about_large_orders_v2";
    draft.nodes.push({
      key: longKey,
      nodeType: "n8n-nodes-base.renameKeys",
      label: "Rename Shipping Fields",
      params: { keys: [{ from: "customer_shipping_address_line_one", to: "shipping_address_line_one_v2" }] },
    });
    draft.edges.push({ from: "shape", to: longKey });
    draft.tests.cases[0]!.expect.reachedNodes.push(longKey);
    const result = checkFlowSpec(draft);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const compiled = compileFlow(result.spec);
      expect(validateWorkflow(compiled.workflow, compiled.checklist)).toEqual({ ok: true });
      expect(() => assertExportSafe(compiled.workflow)).not.toThrow();
    }
    // A real key in a node key position or a renamed field is still found.
    const planted = baseDraft();
    planted.nodes[1] = { ...planted.nodes[1]!, params: { fields: [{ name: "a", value: PLANTED_KEY }], keepOtherFields: true } };
    expect(rulesOf(planted)).toEqual(["F9"]);
  });

  it("F10: respondToWebhook needs a webhook set to respondNode, and that webhook needs one", () => {
    const responder = { key: "reply", nodeType: "n8n-nodes-base.respondToWebhook" as const, label: "Reply", params: { statusCode: 200, body: [] } };

    const missing = webhookDraft();
    missing.nodes[0] = { ...missing.nodes[0]!, params: { path: "hook", method: "POST", respond: "respondNode" } };
    expect(checkFlowSpec(missing)).toEqual({ ok: false, errors: [{ rule: "F10", nodeKey: "hook" }] });

    const immediate = webhookDraft();
    immediate.nodes.push(responder);
    immediate.edges.push({ from: "notify", to: "reply" });
    expect(checkFlowSpec(immediate)).toEqual({ ok: false, errors: [{ rule: "F10", nodeKey: "reply" }] });

    const manual = baseDraft();
    manual.nodes.push(responder);
    manual.edges.push({ from: "shape", to: "reply" });
    expect(checkFlowSpec(manual)).toEqual({ ok: false, errors: [{ rule: "F10", nodeKey: "reply" }] });

    const good = webhookDraft();
    good.nodes[0] = { ...good.nodes[0]!, params: { path: "hook", method: "POST", respond: "respondNode" } };
    good.nodes.push(responder);
    good.edges.push({ from: "notify", to: "reply" });
    expect(checkFlowSpec(good).ok).toBe(true);
  });

  it("F11: the TestSpec shape", () => {
    const noCases = baseDraft();
    noCases.tests = { cases: [] };
    expect(rulesOf(noCases)).toEqual(["F11"]);

    const wrongKind = baseDraft();
    wrongKind.tests.cases[0]!.trigger.kind = "webhook";
    expect(rulesOf(wrongKind)).toEqual(["F11"]);

    const emptyReached = baseDraft();
    emptyReached.tests.cases[0]!.expect.reachedNodes = [];
    expect(rulesOf(emptyReached)).toEqual(["F11"]);

    for (const mutate of [
      (draft: FlowSpecDraft) => (draft.tests.cases[0]!.mocks = { ghost: 1 }),
      (draft: FlowSpecDraft) => (draft.tests.cases[0]!.expect.outputs = { ghost: 1 }),
      (draft: FlowSpecDraft) => draft.tests.cases[0]!.expect.reachedNodes.push("ghost"),
      (draft: FlowSpecDraft) => (draft.tests.cases[0]!.expect.notReachedNodes = ["ghost"]),
    ]) {
      const draft = baseDraft();
      mutate(draft);
      expect(rulesOf(draft)).toEqual(["F11"]);
    }

    const badShape = baseDraft();
    (badShape as { tests: unknown }).tests = { cases: [{ name: "x" }] };
    expect(rulesOf(badShape)).toEqual(["F11"]);
  });

  it("F12: a serialized FlowSpec over 256 KB", () => {
    const draft = baseDraft();
    draft.tests.cases[0]!.trigger.payload = { blob: "a".repeat(257 * 1024) };
    expect(checkFlowSpec(draft)).toEqual({ ok: false, errors: [{ rule: "F12" }] });
  });

  it("errors come back sorted by rule and never carry text from the draft", () => {
    const draft = webhookDraft();
    draft.nodes[2] = { ...draft.nodes[2]!, params: { channel: "nope", text: "={{ $env.A }}" } };
    draft.tests.cases[0]!.trigger.kind = "manual";
    draft.edges.push({ from: "notify", to: "ghost" });
    const result = checkFlowSpec(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const rules = result.errors.map((error) => error.rule);
      expect(rules).toEqual(["F4", "F8", "F11"]);
      for (const error of result.errors) {
        expect(Object.keys(error).every((key) => key === "rule" || key === "nodeKey")).toBe(true);
      }
    }
  });
});

describe("FlowSpecDraft schema (strict objects)", () => {
  it("accepts the base draft and every conformance spec", () => {
    expect(flowSpecDraftSchema.safeParse(baseDraft()).success).toBe(true);
  });

  it.each([
    ["an unknown top-level key", (draft: Record<string, unknown>) => (draft.requiredCredentials = [])],
    ["an unknown node key", (draft: Record<string, unknown>) => ((draft.nodes as Record<string, unknown>[])[0]!.credentials = { id: "1" })],
    ["an unknown edge key", (draft: Record<string, unknown>) => ((draft.edges as Record<string, unknown>[])[0]!.type = "main")],
    ["an unknown test key", (draft: Record<string, unknown>) => ((draft.tests as Record<string, unknown>).level = "simulated")],
    ["version 2", (draft: Record<string, unknown>) => (draft.version = 2)],
    ["a short name", (draft: Record<string, unknown>) => (draft.name = "ab")],
    ["a key with a capital", (draft: Record<string, unknown>) => ((draft.nodes as Record<string, unknown>[])[0]!.key = "Start")],
    ["a label with markup", (draft: Record<string, unknown>) => ((draft.nodes as Record<string, unknown>[])[0]!.label = "<b>Start</b>")],
    ["a label starting with =", (draft: Record<string, unknown>) => ((draft.nodes as Record<string, unknown>[])[0]!.label = "=Start")],
    ["notes over 300 chars", (draft: Record<string, unknown>) => ((draft.nodes as Record<string, unknown>[])[0]!.notes = "a".repeat(301))],
    ["params that are not JSON", (draft: Record<string, unknown>) => ((draft.nodes as Record<string, unknown>[])[0]!.params = { when: new Date(0) })],
    ["a negative output index", (draft: Record<string, unknown>) => ((draft.edges as Record<string, unknown>[])[0]!.output = -1)],
  ])("rejects %s", (_label, mutate) => {
    const draft = baseDraft() as unknown as Record<string, unknown>;
    mutate(draft);
    expect(flowSpecDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("refuses params nested deeper than the JSON depth limit without overflowing the stack", () => {
    let deep: unknown = "x";
    for (let index = 0; index < 50_000; index += 1) deep = [deep];
    const draft = baseDraft() as unknown as { nodes: { params: unknown }[] };
    draft.nodes[0]!.params = { deep };
    expect(flowSpecDraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe("injection (security.md section 9)", () => {
  const withText = (text: string): FlowSpecDraft => {
    const draft = webhookDraft();
    draft.nodes[2] = { ...draft.nodes[2]!, params: { channel: "YOUR_SLACK_CHANNEL", text } };
    return draft;
  };

  it("={{ $env.SECRET }} fails F8", () => {
    expect(checkFlowSpec(withText("={{ $env.SECRET }}"))).toEqual({ ok: false, errors: [{ rule: "F8", nodeKey: "notify" }] });
  });

  it("{{ $json.a.constructor() }} fails F8", () => {
    expect(checkFlowSpec(withText("{{ $json.a.constructor() }}"))).toEqual({
      ok: false,
      errors: [{ rule: "F8", nodeKey: "notify" }],
    });
  });

  it("<script> compiles as an inert literal", () => {
    const html = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    const result = checkFlowSpec(withText(html));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const node = compileFlow(result.spec).workflow.nodes.find((item) => item.name === "Notify");
      // Emitted byte for byte, with no "=" prefix, so n8n never evaluates it.
      expect(node?.parameters.text).toBe(html);
    }
  });
});
