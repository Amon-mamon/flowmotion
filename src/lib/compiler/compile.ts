import { normalizeEdges } from "@/lib/flowspec/graph";
import { catalogNode } from "@/lib/n8n-catalog/catalog";
import { nodeProfile } from "@/lib/n8n-catalog/profiles";
import { stableId } from "@/lib/n8n-catalog/profiles/types";
import type { JsonValue, SetupChecklist } from "@/schemas/flow";
import type { FlowSpec } from "@/schemas/flowspec";

import { buildChecklist } from "./checklist";
import { layoutFlow } from "./layout";
import type { N8nConnectionTarget, N8nNode, N8nWorkflow } from "./types";

/**
 * The compiler (docs/contract.md section 8): FlowSpec in, n8n workflow JSON
 * and setup checklist out. Pure and deterministic: the same spec gives the
 * same bytes. The AI never writes n8n JSON; this does.
 */

/** Thrown when a spec that did not pass `checkFlowSpec` reaches the compiler. */
export class CompileError extends Error {
  constructor(
    readonly reason: "unknown_node_type" | "invalid_params" | "unknown_edge_node",
    readonly nodeKey?: string,
  ) {
    super(`Cannot compile flow: ${reason}`);
    this.name = "CompileError";
  }
}

/**
 * The only place a leading `=` is ever added: a string that holds `{{` is an
 * n8n expression template; every other string is emitted as is.
 */
function markExpressions(value: JsonValue): JsonValue {
  if (typeof value === "string") return value.includes("{{") ? `=${value}` : value;
  if (Array.isArray(value)) return value.map(markExpressions);
  if (value !== null && typeof value === "object") {
    // Own properties only (D-49): `Object.fromEntries` defines keys, never assigns them.
    return Object.fromEntries(
      Object.entries(value).map(([key, child]): [string, JsonValue] => [key, markExpressions(child)]),
    );
  }
  return value;
}

export interface CompiledFlow {
  workflow: N8nWorkflow;
  checklist: SetupChecklist;
}

export function compileFlow(spec: FlowSpec): CompiledFlow {
  const positions = layoutFlow(spec.nodes, spec.edges);
  const labelByKey = new Map(spec.nodes.map((node) => [node.key, node.label]));

  const nodes: N8nNode[] = spec.nodes.map((node) => {
    const profile = nodeProfile(node.nodeType);
    const catalog = catalogNode(node.nodeType);
    if (profile === undefined || catalog === undefined) throw new CompileError("unknown_node_type", node.key);
    const params = profile.paramsSchema.safeParse(node.params);
    if (!params.success) throw new CompileError("invalid_params", node.key);
    const position = positions.get(node.key) ?? { x: 0, y: 0 };
    const parameters: Record<string, JsonValue> = Object.fromEntries(
      Object.entries(profile.toParameters(params.data)).map(([name, value]): [string, JsonValue] => [
        name,
        markExpressions(value),
      ]),
    );
    return {
      id: stableId(`node:${node.key}`),
      name: node.label,
      type: node.nodeType,
      typeVersion: catalog.typeVersion,
      position: [position.x, position.y],
      parameters,
    };
  });

  // Connections are keyed by node name, in spec order; `main[i]` is output i.
  const outputs = new Map<string, N8nConnectionTarget[][]>();
  for (const edge of normalizeEdges(spec.edges)) {
    const target = labelByKey.get(edge.to);
    if (target === undefined || !labelByKey.has(edge.from)) throw new CompileError("unknown_edge_node");
    let main = outputs.get(edge.from);
    if (main === undefined) {
      main = [];
      outputs.set(edge.from, main);
    }
    while (main.length <= edge.output) main.push([]);
    main[edge.output]?.push({ node: target, type: "main", index: edge.input });
  }
  const connections: N8nWorkflow["connections"] = {};
  for (const node of spec.nodes) {
    const main = outputs.get(node.key);
    if (main !== undefined) connections[node.label] = { main };
  }

  const workflow: N8nWorkflow = {
    name: spec.name,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };
  return { workflow, checklist: buildChecklist(spec, workflow) };
}

/** The export text: pretty-printed with 2 spaces and a trailing newline. */
export function serializeWorkflow(workflow: N8nWorkflow): string {
  return `${JSON.stringify(workflow, null, 2)}\n`;
}
