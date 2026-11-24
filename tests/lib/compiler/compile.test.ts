// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compileFlow, CompileError, layoutFlow, serializeWorkflow, type N8nNode } from "@/lib/compiler";
import {
  WARNING_HTTP,
  WARNING_MESSAGES,
  WARNING_REVIEW,
  WARNING_WEBHOOK,
  WARNING_WRITES,
} from "@/lib/compiler/checklist";
import { checkFlowSpec } from "@/lib/flowspec";
import { parseTemplate } from "@/lib/flowspec/expression";
import { ALLOWED_NODE_TYPES } from "@/lib/n8n-catalog/allowlist";
import { NODE_CATALOG } from "@/lib/n8n-catalog/catalog";
import { setupChecklistSchema } from "@/schemas/flow";
import type { FlowSpec, FlowSpecDraft } from "@/schemas/flowspec";

import { baseDraft, compileSpec, goldenPath, loadSpec, SPEC_NAMES } from "../flow/helpers";

/** Regenerate the goldens on purpose with: UPDATE_GOLDENS=1 npx vitest run tests/lib/compiler */
const UPDATE = process.env.UPDATE_GOLDENS === "1";

function specOf(draft: FlowSpecDraft): FlowSpec {
  const result = checkFlowSpec(draft);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, into));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((item) => strings(item, into));
  return into;
}

function keys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keys(item, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.push(key);
      keys(child, into);
    }
  }
  return into;
}

describe("compiler: golden files (tests/conformance)", () => {
  it.each(SPEC_NAMES)("%s compiles to its golden export, byte for byte", (name) => {
    const text = serializeWorkflow(compileSpec(name).workflow);
    if (UPDATE) writeFileSync(goldenPath(name), text);
    expect(existsSync(goldenPath(name))).toBe(true);
    expect(text).toBe(readFileSync(goldenPath(name), "utf8"));
  });

  it.each(SPEC_NAMES)("%s is byte-stable across two runs", (name) => {
    const first = compileFlow(loadSpec(name));
    const second = compileFlow(loadSpec(name));
    expect(serializeWorkflow(second.workflow)).toBe(serializeWorkflow(first.workflow));
    expect(JSON.stringify(second.checklist)).toBe(JSON.stringify(first.checklist));
  });

  const goldenNodes: N8nNode[] = SPEC_NAMES.flatMap(
    (name) => (JSON.parse(readFileSync(goldenPath(name), "utf8")) as { nodes: N8nNode[] }).nodes,
  );
  const compiledNodes: N8nNode[] = SPEC_NAMES.flatMap((name) => compileSpec(name).workflow.nodes);

  it.each(ALLOWED_NODE_TYPES)("golden per node type: %s", (type) => {
    const golden = goldenNodes.filter((node) => node.type === type);
    expect(golden.length).toBeGreaterThan(0);
    for (const node of golden) {
      expect(node.typeVersion).toBe(NODE_CATALOG.nodes[type]?.typeVersion);
      expect(compiledNodes).toContainEqual(node);
    }
  });

  it("the goldens also cover the second operation of the two-operation nodes", () => {
    const operations = (type: string) => new Set(goldenNodes.filter((node) => node.type === type).map((node) => node.parameters.operation));
    expect(operations("n8n-nodes-base.postgres")).toEqual(new Set(["select", "insert"]));
    expect(operations("n8n-nodes-base.supabase")).toEqual(new Set(["getAll", "create"]));
    expect(operations("n8n-nodes-base.googleSheets")).toEqual(new Set(["append", "read"]));
    expect(operations("n8n-nodes-base.dateTime")).toEqual(new Set(["getCurrentDate", "formatDate"]));
  });
});

describe("compiler: workflow structure (contract section 8)", () => {
  const { workflow } = compileSpec("order-webhook");

  it("top-level keys are exactly name, nodes, connections, settings", () => {
    expect(Object.keys(workflow)).toEqual(["name", "nodes", "connections", "settings"]);
    expect(workflow.settings).toEqual({ executionOrder: "v1" });
    expect(workflow.name).toBe("Order webhook alerts");
  });

  it("nodes carry id, name, type, typeVersion, position, parameters and nothing else", () => {
    for (const name of SPEC_NAMES) {
      for (const node of compileSpec(name).workflow.nodes) {
        expect(Object.keys(node)).toEqual(["id", "name", "type", "typeVersion", "position", "parameters"]);
        expect(node.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    }
  });

  it("node ids derive from the node key, names are the labels, and both are unique", () => {
    const spec = loadSpec("order-webhook");
    expect(workflow.nodes.map((node) => node.name)).toEqual(spec.nodes.map((node) => node.label));
    expect(new Set(workflow.nodes.map((node) => node.id)).size).toBe(workflow.nodes.length);
    const renamed: FlowSpec = { ...spec, nodes: spec.nodes.map((node) => ({ ...node })) };
    renamed.nodes[1]!.label = "Renamed";
    renamed.nodes[6]!.params = { statusCode: 200, body: [] };
    expect(compileFlow(renamed).workflow.nodes[1]?.id).toBe(workflow.nodes[1]?.id);
  });

  it("connections are keyed by name with one list per output: if 0 = true, 1 = false; merge inputs 0 and 1", () => {
    expect(workflow.connections["Large Order"]).toEqual({
      main: [
        [{ node: "Notify Sales", type: "main", index: 0 }],
        [{ node: "Email Team", type: "main", index: 0 }],
      ],
    });
    expect(workflow.connections["Notify Sales"]?.main[0]).toEqual([{ node: "Join Branches", type: "main", index: 0 }]);
    expect(workflow.connections["Email Team"]?.main[0]).toEqual([{ node: "Join Branches", type: "main", index: 1 }]);
    expect(workflow.connections).not.toHaveProperty("Reply");
  });

  it("splitInBatches: output 0 is done, output 1 is the loop, and the body returns to it", () => {
    const loop = compileSpec("nightly-report").workflow;
    expect(loop.connections["Each Batch"]?.main).toEqual([
      [{ node: "Collect", type: "main", index: 0 }],
      [{ node: "Push To CRM", type: "main", index: 0 }],
    ]);
    expect(loop.connections.Pause?.main).toEqual([[{ node: "Each Batch", type: "main", index: 0 }]]);
  });

  it("switch: one output per case and the fallback last", () => {
    const triage = compileSpec("support-triage").workflow;
    expect(triage.connections["Route Priority"]?.main.map((targets) => targets.map((target) => target.node))).toEqual([
      ["Alert On Call"],
      ["Post To Discord"],
      ["Post To Discord"],
      ["Ignore"],
    ]);
    const node = triage.nodes.find((item) => item.name === "Route Priority");
    expect(node?.parameters.options).toEqual({ fallbackOutput: "extra" });
  });

  it("an unused middle output is an empty list", () => {
    const draft = baseDraft();
    draft.nodes.push({
      key: "branch",
      nodeType: "n8n-nodes-base.if",
      label: "Branch",
      params: { conditions: [{ left: "{{ $json.greeting }}", op: "exists" }], combine: "and" },
    });
    draft.nodes.push({ key: "end", nodeType: "n8n-nodes-base.noOp", label: "End", params: {} });
    draft.edges.push({ from: "shape", to: "branch" }, { from: "branch", to: "end", output: 1 });
    expect(compileFlow(specOf(draft)).workflow.connections.Branch).toEqual({
      main: [[], [{ node: "End", type: "main", index: 0 }]],
    });
  });

  it("no node carries a credentials key, anywhere", () => {
    for (const name of SPEC_NAMES) {
      const compiled = compileSpec(name);
      expect(keys(compiled.workflow)).not.toContain("credentials");
      expect(serializeWorkflow(compiled.workflow)).not.toMatch(/credential/i);
    }
  });

  it("refuses a spec that did not pass the FlowSpec rules", () => {
    const spec = loadSpec("order-webhook");
    const badParams: FlowSpec = { ...spec, nodes: spec.nodes.map((node) => ({ ...node })) };
    badParams.nodes[3]!.params = { channel: "#general", text: "x" };
    expect(() => compileFlow(badParams)).toThrow(CompileError);
    const badType = { ...spec, nodes: spec.nodes.map((node) => ({ ...node })) };
    (badType.nodes[3] as { nodeType: string }).nodeType = "n8n-nodes-base.code";
    expect(() => compileFlow(badType)).toThrow(CompileError);
    const badEdge: FlowSpec = { ...spec, edges: [...spec.edges, { from: "reply", to: "ghost" }] };
    expect(() => compileFlow(badEdge)).toThrow(CompileError);
  });
});

describe("compiler: expressions", () => {
  it("adds the = prefix only to texts that hold {{", () => {
    let withPrefix = 0;
    for (const name of SPEC_NAMES) {
      for (const node of compileSpec(name).workflow.nodes) {
        for (const text of strings(node.parameters)) {
          if (text.includes("{{")) {
            expect(text.startsWith("="), text).toBe(true);
            expect(text.startsWith("=="), text).toBe(false);
            const parsed = parseTemplate(text.slice(1));
            expect(parsed.ok && parsed.hasExpression, text).toBe(true);
            withPrefix += 1;
          } else {
            expect(text.startsWith("="), text).toBe(false);
          }
        }
        // Names, ids and types are never expressions.
        expect([node.name, node.id, node.type].some((text) => text.startsWith("="))).toBe(false);
      }
    }
    expect(withPrefix).toBeGreaterThan(20);
  });

  it("emits literal and expression texts as written", () => {
    const { workflow } = compileSpec("order-webhook");
    const slack = workflow.nodes.find((node) => node.name === "Notify Sales");
    expect(slack?.parameters.text).toBe("=Large order {{ $json.orderId }} worth {{ $json.total }}");
    expect(slack?.parameters.channelId).toEqual({ __rl: true, mode: "id", value: "YOUR_SLACK_CHANNEL" });
    const email = workflow.nodes.find((node) => node.name === "Email Team");
    expect(email?.parameters.text).toBe("=A new order arrived.\nTotal: {{ $json.total }}");
    expect(email?.parameters.toEmail).toBe("YOUR_TEAM_EMAIL");
    const http = compileSpec("nightly-report").workflow.nodes.find((node) => node.name === "Push To CRM");
    expect(http?.parameters.url).toBe("=YOUR_CRM_API_URL/v1/orders/{{ $json.id }}");
    const reply = workflow.nodes.find((node) => node.name === "Reply");
    expect(reply?.parameters.responseBody).toBe(
      '={"received": true, "orderId": "{{ $node["Shape Order"].json.orderId }}", "note": "Thanks, we got \\"it\\""}',
    );
  });
});

describe("compiler: layout (contract section 8)", () => {
  it("x = 250 + 220 × column, y = 300 + 160 × row; rows keep spec order", () => {
    const { workflow } = compileSpec("order-webhook");
    expect(Object.fromEntries(workflow.nodes.map((node) => [node.name, node.position]))).toEqual({
      "Order Webhook": [250, 300],
      "Shape Order": [470, 300],
      "Large Order": [690, 300],
      "Notify Sales": [910, 300],
      "Email Team": [910, 460],
      "Join Branches": [1130, 300],
      Reply: [1350, 300],
    });
  });

  it("column is the longest path from the trigger", () => {
    const draft = baseDraft();
    draft.nodes.push({ key: "join", nodeType: "n8n-nodes-base.merge", label: "Join", params: { mode: "append" } });
    // start → shape → join and start → join: join sits after shape, in column 2.
    draft.edges.push({ from: "shape", to: "join", input: 0 }, { from: "start", to: "join", input: 1 });
    const positions = layoutFlow(draft.nodes, draft.edges);
    expect(positions.get("start")).toEqual({ x: 250, y: 300 });
    expect(positions.get("shape")).toEqual({ x: 470, y: 300 });
    expect(positions.get("join")).toEqual({ x: 690, y: 300 });
  });

  it("ignores the loop-back edge of a splitInBatches loop", () => {
    const spec = loadSpec("nightly-report");
    const positions = layoutFlow(spec.nodes, spec.edges);
    expect(positions.get("each_batch")).toEqual({ x: 250 + 220 * 5, y: 300 });
    expect(positions.get("push_to_crm")).toEqual({ x: 250 + 220 * 6, y: 300 });
    expect(positions.get("pause")).toEqual({ x: 250 + 220 * 7, y: 300 });
    expect(positions.get("collect")).toEqual({ x: 250 + 220 * 6, y: 460 });
    expect(positions.get("mail_report")).toEqual({ x: 250 + 220 * 7, y: 460 });
  });

  it("the export positions equal layoutFlow, and no two nodes share a position", () => {
    for (const name of SPEC_NAMES) {
      const spec = loadSpec(name);
      const positions = layoutFlow(spec.nodes, spec.edges);
      const { workflow } = compileFlow(spec);
      spec.nodes.forEach((node, index) => {
        const position = positions.get(node.key);
        expect(workflow.nodes[index]?.position).toEqual([position?.x, position?.y]);
      });
      expect(new Set(workflow.nodes.map((node) => node.position.join(","))).size).toBe(workflow.nodes.length);
    }
  });

  it("terminates on a graph with a plain cycle", () => {
    const draft = baseDraft();
    draft.edges.push({ from: "shape", to: "shape" });
    expect(layoutFlow(draft.nodes, draft.edges).size).toBe(2);
  });
});

describe("compiler: setup checklist", () => {
  it("lists credentials by first use with node labels, and placeholders sorted by name", () => {
    const { checklist } = compileSpec("order-webhook");
    expect(setupChecklistSchema.safeParse(checklist).success).toBe(true);
    expect(checklist.credentials).toEqual([
      { name: "Slack", usedBy: ["Notify Sales"] },
      { name: "SMTP", usedBy: ["Email Team"] },
    ]);
    expect(checklist.placeholders).toEqual([
      { name: "YOUR_FROM_EMAIL", usedBy: ["Email Team"] },
      { name: "YOUR_SLACK_CHANNEL", usedBy: ["Notify Sales"] },
      { name: "YOUR_TEAM_EMAIL", usedBy: ["Email Team"] },
    ]);
  });

  it("warnings are the fixed sentences, in the contract order", () => {
    expect(compileSpec("order-webhook").checklist.warnings).toEqual([WARNING_REVIEW, WARNING_WEBHOOK, WARNING_MESSAGES]);
    expect(compileSpec("nightly-report").checklist.warnings).toEqual([WARNING_REVIEW, WARNING_HTTP, WARNING_MESSAGES]);
    expect(compileSpec("support-triage").checklist.warnings).toEqual([
      WARNING_REVIEW,
      WARNING_WEBHOOK,
      WARNING_WRITES,
      WARNING_MESSAGES,
    ]);
    expect(compileSpec("tag-sync").checklist.warnings).toEqual([WARNING_REVIEW, WARNING_WRITES]);
    expect(compileSpec("lead-import").checklist.warnings).toEqual([WARNING_REVIEW, WARNING_WRITES]);
    expect(compileFlow(specOf(baseDraft())).checklist).toEqual({ credentials: [], placeholders: [], warnings: [WARNING_REVIEW] });
  });

  it("all five warnings together, in order", () => {
    const draft = baseDraft();
    draft.nodes[0] = {
      key: "start",
      nodeType: "n8n-nodes-base.webhook",
      label: "Start",
      params: { path: "x", method: "POST", respond: "immediately" },
    };
    draft.tests.cases[0]!.trigger.kind = "webhook";
    draft.nodes.push(
      { key: "call", nodeType: "n8n-nodes-base.httpRequest", label: "Call", params: { method: "GET", baseUrl: "YOUR_APP_URL", path: "/x" } },
      { key: "page", nodeType: "n8n-nodes-base.notion", label: "Page", params: { databaseId: "YOUR_NOTION_DATABASE_ID", title: "x" } },
      { key: "post", nodeType: "n8n-nodes-base.discord", label: "Post", params: { text: "See YOUR_APP_URL and YOUR_STATUS_PAGE" } },
    );
    draft.edges.push({ from: "shape", to: "call" }, { from: "call", to: "page" }, { from: "page", to: "post" });
    const { checklist } = compileFlow(specOf(draft));
    expect(checklist.warnings).toEqual([WARNING_REVIEW, WARNING_WEBHOOK, WARNING_HTTP, WARNING_WRITES, WARNING_MESSAGES]);
    expect(checklist.warnings).toEqual([
      "Review every node before you activate the workflow in n8n.",
      "n8n creates a new webhook URL on import. Copy it from the Webhook node into the service that calls it.",
      "Add authentication to each HTTP Request node in n8n if your API needs it.",
      "This flow writes data. Try it with test data before using production.",
      "This flow sends messages. Point it at a test channel or address first.",
    ]);
    // A token in free text is listed too, with every node that holds it.
    expect(checklist.placeholders).toEqual([
      { name: "YOUR_APP_URL", usedBy: ["Call", "Post"] },
      { name: "YOUR_NOTION_DATABASE_ID", usedBy: ["Page"] },
      { name: "YOUR_STATUS_PAGE", usedBy: ["Post"] },
    ]);
    expect(checklist.credentials).toEqual([
      { name: "Notion", usedBy: ["Page"] },
      { name: "Discord", usedBy: ["Post"] },
    ]);
  });

  it("reading nodes do not raise the write warning; one credential lists every node using it", () => {
    const draft = baseDraft();
    draft.nodes.push(
      { key: "read_pg", nodeType: "n8n-nodes-base.postgres", label: "Read PG", params: { operation: "select", table: "t", limit: 5 } },
      { key: "read_sb", nodeType: "n8n-nodes-base.supabase", label: "Read SB", params: { operation: "select", table: "t", limit: 5 } },
      {
        key: "read_sheet",
        nodeType: "n8n-nodes-base.googleSheets",
        label: "Read Sheet",
        params: { operation: "read", documentId: "YOUR_SHEET_ID", sheetName: "YOUR_SHEET_NAME" },
      },
      { key: "mail", nodeType: "n8n-nodes-base.gmail", label: "Mail", params: { to: "YOUR_TO_EMAIL", subject: "s", message: "m" } },
    );
    draft.edges.push(
      { from: "shape", to: "read_pg" },
      { from: "read_pg", to: "read_sb" },
      { from: "read_sb", to: "read_sheet" },
      { from: "read_sheet", to: "mail" },
    );
    const { checklist } = compileFlow(specOf(draft));
    expect(checklist.warnings).toEqual([WARNING_REVIEW, WARNING_MESSAGES]);
    expect(checklist.credentials).toEqual([
      { name: "Postgres", usedBy: ["Read PG"] },
      { name: "Supabase", usedBy: ["Read SB"] },
      { name: "Google", usedBy: ["Read Sheet", "Mail"] },
    ]);
  });

  it("a placeholder in the flow name or a label is listed", () => {
    const draft = baseDraft();
    draft.name = "Sync for YOUR_TEAM";
    draft.nodes[1] = { ...draft.nodes[1]!, label: "Send YOUR_THING" };
    expect(compileFlow(specOf(draft)).checklist.placeholders).toEqual([
      { name: "YOUR_TEAM", usedBy: [] },
      { name: "YOUR_THING", usedBy: ["Send YOUR_THING"] },
    ]);
  });
});
