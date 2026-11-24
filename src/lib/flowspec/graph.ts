import { NODE_TYPE_PREFIX } from "@/lib/n8n-catalog/allowlist";
import type { FlowSpecEdge, FlowSpecNode } from "@/schemas/flowspec";

/**
 * Graph helpers over FlowSpec nodes and edges, shared by `checkFlowSpec` and
 * the compiler layout. Pure and runtime-neutral. (The static validator has its
 * own graph code over the compiled JSON: it is the independent second check.)
 */

export const SPLIT_IN_BATCHES_TYPE = `${NODE_TYPE_PREFIX}splitInBatches`;
/** `splitInBatches` output 1 is the loop branch. */
export const LOOP_OUTPUT = 1;

export interface NormalEdge {
  from: string;
  to: string;
  output: number;
  input: number;
}

export function normalizeEdges(edges: readonly FlowSpecEdge[]): NormalEdge[] {
  return edges.map((edge) => ({ from: edge.from, to: edge.to, output: edge.output ?? 0, input: edge.input ?? 0 }));
}

function adjacency(edges: readonly NormalEdge[]): Map<string, NormalEdge[]> {
  const out = new Map<string, NormalEdge[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list === undefined) out.set(edge.from, [edge]);
    else list.push(edge);
  }
  return out;
}

/** Keys reachable from `start` (inclusive). */
export function reachableFrom(start: string, edges: readonly NormalEdge[]): Set<string> {
  const out = adjacency(edges);
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key === undefined) break;
    for (const edge of out.get(key) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        stack.push(edge.to);
      }
    }
  }
  return seen;
}

/**
 * The loop-back edges: an edge into a `splitInBatches` node from a node that
 * is reachable from that node's loop output without passing through it.
 */
export function loopBackEdges(nodes: readonly FlowSpecNode[], edges: readonly NormalEdge[]): Set<NormalEdge> {
  const out = adjacency(edges);
  const back = new Set<NormalEdge>();
  for (const node of nodes) {
    if (node.nodeType !== SPLIT_IN_BATCHES_TYPE) continue;
    const body = new Set<string>();
    const stack: string[] = [];
    for (const edge of out.get(node.key) ?? []) {
      if (edge.output === LOOP_OUTPUT && edge.to !== node.key && !body.has(edge.to)) {
        body.add(edge.to);
        stack.push(edge.to);
      }
    }
    while (stack.length > 0) {
      const key = stack.pop();
      if (key === undefined) break;
      for (const edge of out.get(key) ?? []) {
        if (edge.to !== node.key && !body.has(edge.to)) {
          body.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    for (const edge of edges) {
      if (edge.to === node.key && body.has(edge.from)) back.add(edge);
    }
  }
  return back;
}

/**
 * Longest-path depth of every node over `edges` (Kahn's algorithm). Nodes on a
 * cycle are missing from the result, so `size < keys.length` means a cycle.
 */
export function longestPathDepths(keys: readonly string[], edges: readonly NormalEdge[]): Map<string, number> {
  const known = new Set(keys);
  const usable = edges.filter((edge) => known.has(edge.from) && known.has(edge.to));
  const out = adjacency(usable);
  const indegree = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const edge of usable) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const depth = new Map<string, number>();
  const queue = keys.filter((key) => indegree.get(key) === 0);
  for (const key of queue) depth.set(key, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const key = queue[index];
    if (key === undefined) break;
    const current = depth.get(key) ?? 0;
    for (const edge of out.get(key) ?? []) {
      depth.set(edge.to, Math.max(depth.get(edge.to) ?? 0, current + 1));
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(edge.to);
    }
  }
  const done = new Map<string, number>();
  for (const key of queue) done.set(key, depth.get(key) ?? 0);
  return done;
}

/** Keys of the nodes upstream of `key` (loop-back edges included), excluding `key` unless it is on a loop. */
export function upstreamOf(key: string, edges: readonly NormalEdge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.to);
    if (list === undefined) incoming.set(edge.to, [edge.from]);
    else list.push(edge.from);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(key) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(incoming.get(current) ?? []));
  }
  return seen;
}
