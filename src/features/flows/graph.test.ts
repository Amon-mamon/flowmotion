import { describe, expect, it } from "vitest";

import { readyEdges, readyFlow, readyNodes } from "@/features/flows/fixtures";
import { edgeLabel, inGraphOrder, shortNodeType, toCanvasEdges, toCanvasNodes } from "@/features/flows/graph";
import type { FlowNodeView } from "@/features/flows/schemas";

const node = (overrides: Partial<FlowNodeView>): FlowNodeView => ({ ...readyNodes[1]!, ...overrides });

describe("flow graph mapping", () => {
  it("short type name is the part after the last dot", () => {
    expect(shortNodeType("n8n-nodes-base.slack")).toBe("slack");
    expect(shortNodeType("slack")).toBe("slack");
  });

  it("nodes keep the API positions, are read-only, and follow graph order", () => {
    const shuffled = [...readyNodes].reverse();
    expect(inGraphOrder(shuffled).map((n) => n.key)).toEqual(readyNodes.map((n) => n.key));
    const nodes = toCanvasNodes({ nodes: shuffled });
    expect(nodes.map((n) => n.id)).toEqual(readyNodes.map((n) => n.key));
    for (const canvasNode of nodes) {
      const source = readyNodes.find((n) => n.key === canvasNode.id)!;
      expect(canvasNode.position).toEqual(source.position);
      expect(canvasNode).toMatchObject({ draggable: false, connectable: false, deletable: false });
      expect(canvasNode.handles).toHaveLength(source.inputs + source.outputs);
    }
  });

  it("labels only edges that leave a multi-output node", () => {
    const labels = Object.fromEntries(toCanvasEdges(readyFlow).map((edge) => [edge.id, edge.label]));
    expect(labels).toEqual({
      "order_webhook:0->is_paid:0": undefined,
      "is_paid:0->notify_team:0": "true",
      "is_paid:1->fetch_order:0": "false",
      "notify_team:0->join:0": undefined,
      "fetch_order:0->join:1": undefined,
      "join:0->log_order:0": undefined,
      "log_order:0->reply:0": undefined,
    });
  });

  it("uses the output label for splitInBatches and switch, and none for an unnamed output", () => {
    const edge = (output: number) => ({ id: "e", from: "a", to: "b", output, input: 0 });
    const loop = node({ outputs: 2, outputLabels: ["done", "loop"] });
    expect(edgeLabel(edge(0), loop)).toBe("done");
    expect(edgeLabel(edge(1), loop)).toBe("loop");
    const sw = node({ outputs: 3, outputLabels: ["paid", "refunded", "fallback"] });
    expect([0, 1, 2].map((i) => edgeLabel(edge(i), sw))).toEqual(["paid", "refunded", "fallback"]);
    expect(edgeLabel(edge(0), node({ outputs: 2, outputLabels: ["", ""] }))).toBeUndefined();
    expect(edgeLabel(edge(0), node({ outputs: 1, outputLabels: ["true"] }))).toBeUndefined();
    expect(edgeLabel(edge(0), undefined)).toBeUndefined();
  });

  it("connects each edge to its output and input handle, with an arrowhead, and drops broken edges", () => {
    const edges = toCanvasEdges(readyFlow);
    expect(edges).toHaveLength(readyEdges.length);
    const intoMerge = edges.find((edge) => edge.id === "fetch_order:0->join:1")!;
    expect(intoMerge).toMatchObject({ source: "fetch_order", target: "join", sourceHandle: "out-0", targetHandle: "in-1" });
    expect(intoMerge.markerEnd).toMatchObject({ type: "arrowclosed" });

    const broken = toCanvasEdges({
      nodes: readyNodes,
      edges: [
        { id: "x", from: "missing", to: "join", output: 0, input: 0 },
        { id: "y", from: "is_paid", to: "join", output: 5, input: 0 },
        { id: "z", from: "is_paid", to: "join", output: 0, input: 9 },
      ],
    });
    expect(broken).toEqual([]);
  });
});
