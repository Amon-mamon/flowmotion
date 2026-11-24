import { z } from "zod";

import { parseTemplate } from "@/lib/flowspec/expression";
import { isAllowedNodeType, NODE_TYPE_PREFIX } from "@/lib/n8n-catalog/allowlist";
import { catalogNode, type CatalogNode } from "@/lib/n8n-catalog/catalog";
import { scan } from "@/lib/security/secret-scanner";
import { isJsonValue, jsonValueSchema, setupChecklistSchema, type JsonValue } from "@/schemas/flow";

/**
 * The static validator (docs/testing.md, 10 rules; level "Valid"). It reads
 * only the compiled n8n JSON, the setup checklist, and the generated catalog.
 * It is the independent second check on the compiler: it never calls the
 * FlowSpec rules, the node profiles, or the compiler (it shares only the
 * expression parser and the secret scanner). Pure and runtime-neutral.
 */

export type ValidatorRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface ValidatorError {
  rule: ValidatorRule;
  nodeName?: string;
}

export type ValidateWorkflowResult = { ok: true } | { ok: false; errors: ValidatorError[] };

export const MAX_EXPORT_BYTES = 256 * 1024;
export const MAX_EXPORT_NODES = 40;

const NODE_KEYS: ReadonlySet<string> = new Set(["id", "name", "type", "typeVersion", "position", "parameters"]);
const SPLIT_IN_BATCHES = `${NODE_TYPE_PREFIX}splitInBatches`;
const HTTP_REQUEST = `${NODE_TYPE_PREFIX}httpRequest`;
const SWITCH = `${NODE_TYPE_PREFIX}switch`;
const MERGE = `${NODE_TYPE_PREFIX}merge`;

/** Excluded in v1 (docs/node-catalog.md): never allowed in an export. */
export const EXCLUDED_NODE_NAMES: ReadonlySet<string> = new Set([
  "code",
  "function",
  "functionItem",
  "executeCommand",
  "readWriteFile",
  "readBinaryFile",
  "readBinaryFiles",
  "writeBinaryFile",
  "ssh",
  "ftp",
  "executeWorkflow",
  "executeWorkflowTrigger",
  "errorTrigger",
  "localFileTrigger",
  "n8n",
  "n8nTrigger",
]);
const ALLOWED_TRIGGER_NAMES: ReadonlySet<string> = new Set(["manualTrigger", "scheduleTrigger"]);

const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
]);
/** httpRequest parameters that could carry headers, credentials, or a body the header check cannot see. */
const FORBIDDEN_HTTP_PARAMETERS: readonly string[] = [
  "jsonHeaders",
  "nodeCredentialType",
  "genericAuthType",
  "provideSslCertificates",
  "sslCertificate",
];

const PLACEHOLDER_TOKEN = /YOUR_[A-Z0-9_]{2,40}/g;
const HTTP_URL = /^=?(YOUR_[A-Z0-9_]{2,40})(?:\/[\s\S]*)?$/;

/** The path the scanner sees: a plain JSON file, so no file-specific rule applies. */
const SCAN_PATH = "workflow.n8n.json";

const targetSchema = z.strictObject({
  node: z.string(),
  type: z.literal("main"),
  index: z.number().int().nonnegative(),
});

const nodeSchema = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(200),
  typeVersion: z.number().positive(),
  position: z.tuple([z.number(), z.number()]),
  parameters: z.record(z.string(), jsonValueSchema),
});

/** Rule 1: the n8n workflow structure (docs/contract.md section 8). */
const workflowSchema = z.strictObject({
  name: z.string().min(1).max(200),
  nodes: z.array(nodeSchema),
  connections: z.record(z.string(), z.strictObject({ main: z.array(z.array(targetSchema)) })),
  settings: z.strictObject({ executionOrder: z.literal("v1") }),
});
type Workflow = z.infer<typeof workflowSchema>;
type WorkflowNode = Workflow["nodes"][number];

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Walks a JSON value, calling `onString` for every string and `onKey` for every object key. */
function walk(value: unknown, onString: (text: string) => void, onKey?: (key: string) => void): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      onString(current);
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current !== null && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        onKey?.(key);
        stack.push(child);
      }
    }
  }
}

const RENAME_KEYS = `${NODE_TYPE_PREFIX}renameKeys`;

/**
 * The text the scanner reads (rule 7 and `assertExportSafe`): the export as
 * pretty JSON. One adjustment: in a `renameKeys` node n8n names the field
 * paths `currentKey` / `newKey`, and the scanner's secret-name rule would read
 * every longer field path as a secret assigned to a name containing "key".
 * Those two properties are written as `from` / `to`; their values are still
 * scanned.
 */
export function renderForScan(workflow: JsonValue): string {
  const nodes = asRecord(workflow)?.nodes;
  if (!Array.isArray(nodes)) return JSON.stringify(workflow, null, 2);
  const neutral = nodes.map((node) => {
    const record = asRecord(node);
    if (record === null || record.type !== RENAME_KEYS) return node;
    const text = JSON.stringify(record.parameters ?? null, (_key, value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const renamed: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        renamed[key === "currentKey" ? "from" : key === "newKey" ? "to" : key] = child;
      }
      return renamed;
    });
    return { ...record, parameters: JSON.parse(text) as JsonValue };
  });
  return JSON.stringify({ ...asRecord(workflow), nodes: neutral }, null, 2);
}

/** True when any object anywhere in `value` has a `credentials` key. */
export function hasCredentialsKey(value: unknown): boolean {
  let found = false;
  walk(
    value,
    () => undefined,
    (key) => {
      if (key === "credentials") found = true;
    },
  );
  return found;
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function outputCount(node: WorkflowNode, catalog: CatalogNode): number {
  if (typeof catalog.outputs === "number") return catalog.outputs;
  if (node.type === SWITCH) {
    const values = asRecord(node.parameters.rules)?.values;
    const cases = Array.isArray(values) ? values.length : 0;
    const fallback = asRecord(node.parameters.options)?.fallbackOutput === "extra";
    return cases + (fallback ? 1 : 0);
  }
  // webhook (one method) and respondToWebhook (no response output) have one output.
  return 1;
}

function inputCount(node: WorkflowNode, catalog: CatalogNode): number {
  if (typeof catalog.inputs === "number") return catalog.inputs;
  if (node.type === MERGE) {
    const count = node.parameters.numberInputs;
    return typeof count === "number" && Number.isInteger(count) && count >= 2 && count <= 10 ? count : 2;
  }
  return 1;
}

interface Edge {
  from: string;
  to: string;
  output: number;
}

/** Rule 3 helper: true when the graph has a cycle other than a splitInBatches loop. */
function hasForbiddenCycle(nodes: readonly WorkflowNode[], edges: readonly Edge[]): boolean {
  const out = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list === undefined) out.set(edge.from, [edge]);
    else list.push(edge);
  }
  // Drop the loop-back edges: into a splitInBatches node, from its own loop body (output 1).
  const dropped = new Set<Edge>();
  for (const node of nodes) {
    if (node.type !== SPLIT_IN_BATCHES) continue;
    const body = new Set<string>();
    const stack = (out.get(node.name) ?? []).filter((edge) => edge.output === 1).map((edge) => edge.to);
    while (stack.length > 0) {
      const name = stack.pop();
      if (name === undefined || name === node.name || body.has(name)) continue;
      body.add(name);
      for (const edge of out.get(name) ?? []) stack.push(edge.to);
    }
    for (const edge of edges) if (edge.to === node.name && body.has(edge.from)) dropped.add(edge);
  }
  // Three-colour depth-first search over what is left, with an explicit stack.
  const state = new Map<string, 1 | 2>();
  for (const start of nodes) {
    if (state.has(start.name)) continue;
    const stack: { name: string; next: number }[] = [{ name: start.name, next: 0 }];
    state.set(start.name, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const list = (out.get(frame.name) ?? []).filter((edge) => !dropped.has(edge));
      const edge = list[frame.next];
      if (edge === undefined) {
        state.set(frame.name, 2);
        stack.pop();
        continue;
      }
      frame.next += 1;
      const seen = state.get(edge.to);
      if (seen === 1) return true;
      if (seen === undefined) {
        state.set(edge.to, 1);
        stack.push({ name: edge.to, next: 0 });
      }
    }
  }
  return false;
}

function ancestorsOf(name: string, edges: readonly Edge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.to);
    if (list === undefined) incoming.set(edge.to, [edge.from]);
    else list.push(edge.from);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(name) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    stack.push(...(incoming.get(current) ?? []));
  }
  return seen;
}

export function validateWorkflow(workflow: unknown, checklist: unknown): ValidateWorkflowResult {
  const errors: ValidatorError[] = [];
  const add = (rule: ValidatorRule, nodeName?: string): void => {
    if (!errors.some((error) => error.rule === rule && error.nodeName === nodeName)) {
      errors.push(nodeName === undefined ? { rule } : { rule, nodeName });
    }
  };
  const finish = (): ValidateWorkflowResult => {
    if (errors.length === 0) return { ok: true };
    return { ok: false, errors: [...errors].sort((a, b) => a.rule - b.rule) };
  };

  // Rule 10 (size) first: it bounds the work of every other rule.
  if (!isJsonValue(workflow)) return { ok: false, errors: [{ rule: 1 }] };
  const serialized = JSON.stringify(workflow, null, 2);
  if (byteLength(serialized) > MAX_EXPORT_BYTES) return { ok: false, errors: [{ rule: 10 }] };

  // Rule 1: shape.
  const parsed = workflowSchema.safeParse(workflow);
  if (!parsed.success) return { ok: false, errors: [{ rule: 1 }] };
  const flow = parsed.data;
  for (const node of flow.nodes) {
    for (const key of Object.keys(node)) {
      if (!NODE_KEYS.has(key) && key !== "credentials") add(1, node.name);
    }
  }

  // Rule 10: node count.
  if (flow.nodes.length > MAX_EXPORT_NODES) add(10);
  if (flow.nodes.length === 0) add(1);

  // Rule 4 and rule 8: allowlisted types at the catalog's version; no excluded nodes.
  const catalogs = new Map<string, CatalogNode>();
  for (const node of flow.nodes) {
    const catalog = isAllowedNodeType(node.type) ? catalogNode(node.type) : undefined;
    if (catalog === undefined || catalog.typeVersion !== node.typeVersion) add(4, node.name);
    else catalogs.set(node.name, catalog);
    if (!isAllowedNodeType(node.type)) {
      const short = node.type.startsWith(NODE_TYPE_PREFIX) ? node.type.slice(NODE_TYPE_PREFIX.length) : null;
      const excluded =
        short === null ||
        EXCLUDED_NODE_NAMES.has(short) ||
        (short.endsWith("Trigger") && !ALLOWED_TRIGGER_NAMES.has(short));
      if (excluded) add(8, node.name);
    }
  }

  // Rule 2: unique names, connections between existing nodes, indexes in range.
  const byName = new Map<string, WorkflowNode>();
  for (const node of flow.nodes) {
    if (byName.has(node.name)) add(2, node.name);
    byName.set(node.name, node);
  }
  const edges: Edge[] = [];
  for (const [from, entry] of Object.entries(flow.connections)) {
    const source = byName.get(from);
    if (source === undefined) {
      add(2);
      continue;
    }
    const sourceCatalog = catalogs.get(from);
    entry.main.forEach((targets, output) => {
      if (targets.length > 0 && sourceCatalog !== undefined && output >= outputCount(source, sourceCatalog)) {
        add(2, from);
      }
      for (const target of targets) {
        const destination = byName.get(target.node);
        if (destination === undefined) {
          add(2, from);
          continue;
        }
        const destinationCatalog = catalogs.get(target.node);
        if (destinationCatalog !== undefined && target.index >= inputCount(destination, destinationCatalog)) {
          add(2, target.node);
        }
        edges.push({ from, to: target.node, output });
      }
    });
  }

  // Rule 3: exactly one trigger, no orphan nodes, no cycles except splitInBatches loops.
  const triggers = flow.nodes.filter((node) => catalogs.get(node.name)?.inputs === 0);
  const trigger = triggers.length === 1 ? triggers[0] : undefined;
  if (trigger === undefined) {
    add(3);
  } else {
    const reached = new Set<string>([trigger.name]);
    const stack = [trigger.name];
    while (stack.length > 0) {
      const name = stack.pop();
      if (name === undefined) break;
      for (const edge of edges) {
        if (edge.from === name && !reached.has(edge.to)) {
          reached.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    for (const node of flow.nodes) if (!reached.has(node.name)) add(3, node.name);
  }
  if (hasForbiddenCycle(flow.nodes, edges)) add(3);

  for (const node of flow.nodes) {
    // Rule 5: every top-level parameter exists in the catalog; option parameters hold a catalog value.
    const catalog = catalogs.get(node.name);
    if (catalog !== undefined) {
      for (const [name, value] of Object.entries(node.parameters)) {
        const defs = catalog.properties.filter((property) => property.name === name);
        if (defs.length === 0) {
          add(5, node.name);
          continue;
        }
        const optionDefs = defs.filter((def) => def.type === "options" && def.options !== undefined);
        if (optionDefs.length === defs.length) {
          const allowed = optionDefs.some(
            (def) =>
              (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
              def.options?.includes(value) === true,
          );
          if (!allowed) add(5, node.name);
        }
      }
    }

    // Rule 6: expressions only in the supported subset. Rule 8: no plain-http URL.
    let nodeRefs: string[] = [];
    walk(node.parameters, (text) => {
      if (text.toLowerCase().includes("http://")) add(8, node.name);
      if (text.startsWith("=")) {
        const template = parseTemplate(text.slice(1));
        if (!template.ok || !template.hasExpression) add(6, node.name);
        else nodeRefs = nodeRefs.concat(template.nodeRefs);
      } else if (text.includes("{{")) {
        add(6, node.name);
      }
    });
    if (nodeRefs.length > 0) {
      const ancestors = ancestorsOf(node.name, edges);
      if (!nodeRefs.every((name) => name !== node.name && ancestors.has(name))) add(6, node.name);
    }

    // Rule 8: an httpRequest goes to a placeholder origin and carries no authentication.
    if (node.type === HTTP_REQUEST) {
      const url = node.parameters.url;
      const match = typeof url === "string" ? HTTP_URL.exec(url) : null;
      if (match === null || match[1]?.endsWith("_URL") !== true) add(8, node.name);
      const authentication = node.parameters.authentication;
      if (authentication !== undefined && authentication !== "none") add(8, node.name);
      if (FORBIDDEN_HTTP_PARAMETERS.some((name) => name in node.parameters)) add(8, node.name);
      const headers = asRecord(node.parameters.headerParameters)?.parameters;
      if (node.parameters.headerParameters !== undefined && !Array.isArray(headers)) add(8, node.name);
      for (const header of Array.isArray(headers) ? headers : []) {
        const name = asRecord(header)?.name;
        if (typeof name !== "string" || FORBIDDEN_HEADER_NAMES.has(name.trim().toLowerCase())) add(8, node.name);
      }
    }
  }

  // Rule 7: no secrets, no `credentials` key anywhere.
  if (scan(SCAN_PATH, renderForScan(workflow)).findings.length > 0) add(7);
  if (hasCredentialsKey(workflow)) add(7);

  // Rule 9: every YOUR_… placeholder is listed in the setup checklist.
  const list = setupChecklistSchema.safeParse(checklist);
  if (!list.success) {
    add(9);
  } else {
    const listed = new Set(list.data.placeholders.map((placeholder) => placeholder.name));
    for (const match of serialized.matchAll(PLACEHOLDER_TOKEN)) {
      if (!listed.has(match[0])) {
        add(9);
        break;
      }
    }
  }

  return finish();
}
