import type { CredentialName } from "@/lib/n8n-catalog/allowlist";
import { NODE_TYPE_PREFIX } from "@/lib/n8n-catalog/allowlist";
import { nodeProfile } from "@/lib/n8n-catalog/profiles";
import type { SetupChecklist } from "@/schemas/flow";
import type { FlowSpec } from "@/schemas/flowspec";

import type { N8nWorkflow } from "./types";

/**
 * The setup checklist (docs/contract.md section 8): built by code from the
 * FlowSpec and the compiled workflow, never by the model. The warnings are
 * fixed sentences in a fixed order.
 */

export const WARNING_REVIEW = "Review every node before you activate the workflow in n8n.";
export const WARNING_WEBHOOK =
  "n8n creates a new webhook URL on import. Copy it from the Webhook node into the service that calls it.";
export const WARNING_HTTP = "Add authentication to each HTTP Request node in n8n if your API needs it.";
export const WARNING_WRITES = "This flow writes data. Try it with test data before using production.";
export const WARNING_MESSAGES = "This flow sends messages. Point it at a test channel or address first.";

/** Every `YOUR_…` token. */
export const PLACEHOLDER_TOKEN = /YOUR_[A-Z0-9_]{2,40}/g;

const type = (name: string): string => `${NODE_TYPE_PREFIX}${name}`;

const ALWAYS_WRITING: ReadonlySet<string> = new Set([type("airtable"), type("notion"), type("github")]);
const MESSAGING: ReadonlySet<string> = new Set(
  ["emailSend", "gmail", "slack", "discord", "telegram"].map((name) => type(name)),
);

function writes(nodeType: string, params: Record<string, unknown>): boolean {
  if (ALWAYS_WRITING.has(nodeType)) return true;
  if (nodeType === type("postgres") || nodeType === type("supabase")) return params.operation === "insert";
  if (nodeType === type("googleSheets")) return params.operation === "append";
  return false;
}

function collectTokens(value: unknown, into: Set<string>): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      for (const match of current.matchAll(PLACEHOLDER_TOKEN)) into.add(match[0]);
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current !== null && typeof current === "object") {
      stack.push(...Object.keys(current), ...Object.values(current));
    }
  }
}

export function buildChecklist(spec: FlowSpec, workflow: N8nWorkflow): SetupChecklist {
  // Credentials: one entry per catalog credential name, in order of first use.
  const credentials = new Map<CredentialName, string[]>();
  for (const node of spec.nodes) {
    const credential = nodeProfile(node.nodeType)?.credential ?? null;
    if (credential === null) continue;
    const usedBy = credentials.get(credential);
    if (usedBy === undefined) credentials.set(credential, [node.label]);
    else usedBy.push(node.label);
  }

  // Placeholders: every distinct token in the compiled JSON, sorted by name.
  const placeholders = new Map<string, string[]>();
  const workflowTokens = new Set<string>();
  collectTokens(workflow.name, workflowTokens);
  for (const token of workflowTokens) placeholders.set(token, []);
  for (const node of workflow.nodes) {
    const tokens = new Set<string>();
    collectTokens(node.name, tokens);
    collectTokens(node.parameters, tokens);
    for (const token of tokens) {
      const usedBy = placeholders.get(token);
      if (usedBy === undefined) placeholders.set(token, [node.name]);
      else usedBy.push(node.name);
    }
  }

  const types = spec.nodes.map((node) => node.nodeType as string);
  const warnings = [WARNING_REVIEW];
  if (types.includes(type("webhook"))) warnings.push(WARNING_WEBHOOK);
  if (types.includes(type("httpRequest"))) warnings.push(WARNING_HTTP);
  if (spec.nodes.some((node) => writes(node.nodeType, node.params))) warnings.push(WARNING_WRITES);
  if (types.some((nodeType) => MESSAGING.has(nodeType))) warnings.push(WARNING_MESSAGES);

  return {
    credentials: [...credentials.entries()].map(([name, usedBy]) => ({ name, usedBy })),
    placeholders: [...placeholders.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, usedBy]) => ({ name, usedBy })),
    warnings,
  };
}
