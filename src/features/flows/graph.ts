import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";

import type { FlowDetail, FlowEdgeView, FlowNodeView } from "@/features/flows/schemas";

/** Fixed node card size. The API lays columns out 220 px and rows 160 px apart. */
export const NODE_WIDTH = 188;
export const NODE_HEIGHT = 72;

export type FlowCanvasNode = Node<{ node: FlowNodeView }, "flowNode">;
export type FlowCanvasEdge = Edge;

/** "n8n-nodes-base.slack" → "slack" (the part after the last dot). */
export function shortNodeType(nodeType: string): string {
  const index = nodeType.lastIndexOf(".");
  return index === -1 ? nodeType : nodeType.slice(index + 1);
}

export const sourceHandleId = (output: number) => `out-${output}`;
export const targetHandleId = (input: number) => `in-${input}`;

/** Vertical offset of handle `index` of `count`, spread evenly along the card side. */
export function handleOffset(index: number, count: number): number {
  return (NODE_HEIGHT * (index + 1)) / (count + 1);
}

/** Graph order: left to right, then top to bottom (the API's layout), so Tab follows the flow. */
export function inGraphOrder(nodes: readonly FlowNodeView[]): FlowNodeView[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y || a.index - b.index,
    )
    .map((entry) => entry.node);
}

/**
 * Label for an edge: only edges leaving a node with more than one output are
 * labelled, with that output's name ("true" / "false", "done" / "loop", the
 * switch case value, "fallback"). An unnamed output ("") has no label.
 */
export function edgeLabel(edge: FlowEdgeView, source: FlowNodeView | undefined): string | undefined {
  if (!source || source.outputs <= 1) return undefined;
  const label = source.outputLabels[edge.output];
  return label ? label : undefined;
}

/** React Flow nodes from the DTO: positions come from the API, nothing is editable. */
export function toCanvasNodes(flow: Pick<FlowDetail, "nodes">): FlowCanvasNode[] {
  return inGraphOrder(flow.nodes).map((node) => ({
    id: node.key,
    type: "flowNode",
    position: node.position,
    data: { node },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    draggable: false,
    connectable: false,
    deletable: false,
    selectable: false,
    // Known handle positions let edges render before the browser measures the nodes.
    handles: [
      ...Array.from({ length: node.inputs }, (_, i) => ({
        id: targetHandleId(i),
        type: "target" as const,
        position: Position.Left,
        x: 0,
        y: handleOffset(i, node.inputs),
        width: 1,
        height: 1,
      })),
      ...Array.from({ length: node.outputs }, (_, i) => ({
        id: sourceHandleId(i),
        type: "source" as const,
        position: Position.Right,
        x: NODE_WIDTH,
        y: handleOffset(i, node.outputs),
        width: 1,
        height: 1,
      })),
    ],
  }));
}

/** React Flow edges from the DTO. Edges that point at an unknown node or handle are dropped. */
export function toCanvasEdges(flow: Pick<FlowDetail, "nodes" | "edges">): FlowCanvasEdge[] {
  const byKey = new Map(flow.nodes.map((node) => [node.key, node]));
  const edges: FlowCanvasEdge[] = [];
  for (const edge of flow.edges) {
    const source = byKey.get(edge.from);
    const target = byKey.get(edge.to);
    if (!source || !target || edge.output >= source.outputs || edge.input >= target.inputs) continue;
    edges.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: sourceHandleId(edge.output),
      targetHandle: targetHandleId(edge.input),
      type: "smoothstep",
      label: edgeLabel(edge, source),
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      focusable: false,
      selectable: false,
      deletable: false,
      reconnectable: false,
    });
  }
  return edges;
}
