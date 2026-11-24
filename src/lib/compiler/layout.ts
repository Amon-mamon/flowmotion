import { loopBackEdges, longestPathDepths, normalizeEdges } from "@/lib/flowspec/graph";
import type { FlowSpecEdge, FlowSpecNode } from "@/schemas/flowspec";

/**
 * Canvas layout (docs/contract.md section 8), shared by the compiler and by
 * `GET /api/flows/:id` so the canvas and the export agree. Column = longest
 * path from the trigger with loop-back edges ignored; within a column nodes
 * keep their order in `spec.nodes`. Pure and deterministic.
 */

export const LAYOUT_ORIGIN_X = 250;
export const LAYOUT_ORIGIN_Y = 300;
export const LAYOUT_COLUMN_WIDTH = 220;
export const LAYOUT_ROW_HEIGHT = 160;

export interface NodePosition {
  x: number;
  y: number;
}

export function layoutFlow(
  nodes: readonly FlowSpecNode[],
  edges: readonly FlowSpecEdge[],
): Map<string, NodePosition> {
  const normal = normalizeEdges(edges);
  const back = loopBackEdges(nodes, normal);
  const depths = longestPathDepths(
    nodes.map((node) => node.key),
    normal.filter((edge) => !back.has(edge)),
  );
  const rows = new Map<number, number>();
  const positions = new Map<string, NodePosition>();
  for (const node of nodes) {
    // A node left on a cycle has no depth; a checked FlowSpec never has one.
    const column = depths.get(node.key) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(node.key, {
      x: LAYOUT_ORIGIN_X + LAYOUT_COLUMN_WIDTH * column,
      y: LAYOUT_ORIGIN_Y + LAYOUT_ROW_HEIGHT * row,
    });
  }
  return positions;
}
