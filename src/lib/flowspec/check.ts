import type { z } from "zod";

import { parseTemplate } from "@/lib/flowspec/expression";
import { computeRequiredCredentials } from "@/lib/flowspec/credentials";
import { loopBackEdges, longestPathDepths, normalizeEdges, reachableFrom, upstreamOf } from "@/lib/flowspec/graph";
import { TEXT_RULE_MESSAGE } from "@/lib/flowspec/values";
import { isAllowedNodeType, NODE_TYPE_PREFIX } from "@/lib/n8n-catalog/allowlist";
import { nodeProfile } from "@/lib/n8n-catalog/profiles";
import { scanFindsSecret } from "@/lib/security/scan-render";
import {
  MAX_FLOW_NODES,
  MAX_FLOWSPEC_BYTES,
  testSpecSchema,
  type FlowSpec,
  type FlowSpecDraft,
} from "@/schemas/flowspec";

/**
 * FlowSpec rules F1..F12 (docs/contract.md section 7). Pure. Run after the
 * Zod schema on every model draft; the ids are stable and are the only thing
 * fed back to the model or written to logs.
 */

export const FLOWSPEC_RULES = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"] as const;
export type FlowSpecRule = (typeof FLOWSPEC_RULES)[number];

export interface FlowSpecError {
  rule: FlowSpecRule;
  nodeKey?: string;
}

export type CheckFlowSpecResult = { ok: true; spec: FlowSpec } | { ok: false; errors: FlowSpecError[] };

const WEBHOOK_TYPE = `${NODE_TYPE_PREFIX}webhook`;
const RESPOND_TYPE = `${NODE_TYPE_PREFIX}respondToWebhook`;

const TRIGGER_KINDS: Readonly<Record<string, "manual" | "webhook" | "schedule">> = {
  [`${NODE_TYPE_PREFIX}manualTrigger`]: "manual",
  [WEBHOOK_TYPE]: "webhook",
  [`${NODE_TYPE_PREFIX}scheduleTrigger`]: "schedule",
};

/** The path the scanner sees: a plain JSON file, so no file-specific rule applies. */
const SCAN_PATH = "flowspec.json";

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** True when any issue (including those nested in a union) was raised by a text rule. */
function hasTextRuleIssue(issues: readonly z.core.$ZodIssue[]): boolean {
  for (const issue of issues) {
    if (issue.message === TEXT_RULE_MESSAGE) return true;
    if (issue.code === "invalid_union" && issue.errors.some((branch) => hasTextRuleIssue(branch))) return true;
  }
  return false;
}

/** Every string inside a JSON value. */
function collectStrings(value: unknown, into: string[]): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") into.push(current);
    else if (Array.isArray(current)) stack.push(...current);
    else if (current !== null && typeof current === "object") stack.push(...Object.values(current));
  }
}

function sortErrors(errors: FlowSpecError[]): FlowSpecError[] {
  const order = new Map<string, number>(FLOWSPEC_RULES.map((rule, index) => [rule, index]));
  return errors
    .map((error, index) => ({ error, index }))
    .sort((a, b) => (order.get(a.error.rule) ?? 0) - (order.get(b.error.rule) ?? 0) || a.index - b.index)
    .map((item) => item.error);
}

export function checkFlowSpec(draft: FlowSpecDraft): CheckFlowSpecResult {
  const errors: FlowSpecError[] = [];
  const nodes = draft.nodes;

  // F12 first: it bounds the work every other rule does.
  const requiredCredentials = computeRequiredCredentials(nodes);
  const spec: FlowSpec = { ...draft, requiredCredentials };
  const serialized = JSON.stringify(spec);
  if (byteLength(serialized) > MAX_FLOWSPEC_BYTES) {
    return { ok: false, errors: [{ rule: "F12" }] };
  }

  // F1: 1..40 nodes, unique keys, unique labels (case-insensitive).
  if (nodes.length < 1 || nodes.length > MAX_FLOW_NODES) errors.push({ rule: "F1" });
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const node of nodes) {
    const label = node.label.toLowerCase();
    if (keys.has(node.key) || labels.has(label)) errors.push({ rule: "F1", nodeKey: node.key });
    keys.add(node.key);
    labels.add(label);
  }

  // F2: allowlisted node types only.
  for (const node of nodes) {
    if (!isAllowedNodeType(node.nodeType) || nodeProfile(node.nodeType) === undefined) {
      errors.push({ rule: "F2", nodeKey: node.key });
    }
  }

  // The graph rules need unique keys and known types.
  if (errors.length > 0) return { ok: false, errors: sortErrors(errors) };

  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const edges = normalizeEdges(draft.edges);

  // F7 / F8: params against the node profile.
  const validParams = new Set<string>();
  for (const node of nodes) {
    const profile = nodeProfile(node.nodeType);
    if (profile === undefined) continue;
    const parsed = profile.paramsSchema.safeParse(node.params);
    if (parsed.success) validParams.add(node.key);
    else errors.push({ rule: hasTextRuleIssue(parsed.error.issues) ? "F8" : "F7", nodeKey: node.key });
  }

  // F3: exactly one trigger, and nothing connects into it.
  const triggers = nodes.filter((node) => nodeProfile(node.nodeType)?.isTrigger === true);
  const trigger = triggers.length === 1 ? triggers[0] : undefined;
  if (trigger === undefined) errors.push({ rule: "F3" });
  else if (edges.some((edge) => edge.to === trigger.key)) errors.push({ rule: "F3", nodeKey: trigger.key });

  // F4: edges reference existing keys, indexes in range, no duplicates.
  const seenEdges = new Set<string>();
  let edgesUsable = true;
  for (const edge of edges) {
    const from = byKey.get(edge.from);
    const to = byKey.get(edge.to);
    if (from === undefined || to === undefined) {
      errors.push({ rule: "F4" });
      edgesUsable = false;
      continue;
    }
    const id = `${edge.from}:${edge.output}->${edge.to}:${edge.input}`;
    if (seenEdges.has(id)) errors.push({ rule: "F4", nodeKey: edge.from });
    seenEdges.add(id);
    const fromProfile = nodeProfile(from.nodeType);
    const toProfile = nodeProfile(to.nodeType);
    if (fromProfile !== undefined && validParams.has(from.key) && edge.output >= fromProfile.outputs(from.params)) {
      errors.push({ rule: "F4", nodeKey: from.key });
    }
    if (toProfile !== undefined && edge.input >= toProfile.inputs) {
      errors.push({ rule: "F4", nodeKey: to.key });
    }
  }

  if (edgesUsable) {
    // F5: every node is reachable from the trigger.
    if (trigger !== undefined) {
      const reachable = reachableFrom(trigger.key, edges);
      for (const node of nodes) {
        if (!reachable.has(node.key)) errors.push({ rule: "F5", nodeKey: node.key });
      }
    }

    // F6: no cycles except a splitInBatches loop.
    const back = loopBackEdges(nodes, edges);
    const forward = edges.filter((edge) => !back.has(edge));
    const depths = longestPathDepths(
      nodes.map((node) => node.key),
      forward,
    );
    if (depths.size < nodes.length) errors.push({ rule: "F6" });

    // F8 (second half): $node["<label>"] must name an upstream node.
    const keyByLabel = new Map(nodes.map((node) => [node.label, node.key]));
    for (const node of nodes) {
      const strings: string[] = [];
      collectStrings(node.params, strings);
      const refs = strings.flatMap((value) => {
        if (!value.includes("{{")) return [];
        const parsed = parseTemplate(value);
        return parsed.ok ? parsed.nodeRefs : [];
      });
      if (refs.length === 0) continue;
      const upstream = upstreamOf(node.key, edges);
      const allUpstream = refs.every((label) => {
        const key = keyByLabel.get(label);
        return key !== undefined && key !== node.key && upstream.has(key);
      });
      if (!allUpstream) errors.push({ rule: "F8", nodeKey: node.key });
    }
  }

  // F9: no secrets anywhere in the draft, over the shared scan rendering (D-49).
  // Never throws: a draft too deep to render fails F9 (R3aR-1).
  if (scanFindsSecret(SCAN_PATH, draft)) errors.push({ rule: "F9" });

  // F10: respondToWebhook only with a webhook trigger set to "respondNode", and then at least one.
  const responders = nodes.filter((node) => node.nodeType === RESPOND_TYPE);
  const wantsResponder =
    trigger !== undefined && trigger.nodeType === WEBHOOK_TYPE && trigger.params.respond === "respondNode";
  if (wantsResponder && responders.length === 0) errors.push({ rule: "F10", nodeKey: trigger.key });
  if (!wantsResponder) for (const node of responders) errors.push({ rule: "F10", nodeKey: node.key });

  // F11: the TestSpec shape.
  const tests = testSpecSchema.safeParse(draft.tests);
  if (!tests.success || tests.data.cases.length === 0) {
    errors.push({ rule: "F11" });
  } else {
    const triggerKind = trigger === undefined ? undefined : TRIGGER_KINDS[trigger.nodeType];
    const valid = tests.data.cases.every((testCase) => {
      const named = [
        ...Object.keys(testCase.mocks),
        ...Object.keys(testCase.expect.outputs ?? {}),
        ...testCase.expect.reachedNodes,
        ...(testCase.expect.notReachedNodes ?? []),
      ];
      return (
        testCase.trigger.kind === triggerKind &&
        testCase.expect.reachedNodes.length > 0 &&
        named.every((key) => byKey.has(key))
      );
    });
    if (!valid) errors.push({ rule: "F11" });
  }

  if (errors.length > 0) return { ok: false, errors: sortErrors(errors) };
  return { ok: true, spec };
}
