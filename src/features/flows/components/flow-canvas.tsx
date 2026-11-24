"use client";

import "@xyflow/react/dist/style.css";

import { Background, BackgroundVariant, Controls, ReactFlow, type NodeTypes } from "@xyflow/react";
import { useMemo } from "react";

import { FlowNodeCard } from "@/features/flows/components/flow-node-card";
import { toCanvasEdges, toCanvasNodes } from "@/features/flows/graph";
import type { FlowDetail } from "@/features/flows/schemas";

const nodeTypes: NodeTypes = { flowNode: FlowNodeCard };

const FIT_VIEW = { padding: 0.2, maxZoom: 1 } as const;

/**
 * Read-only React Flow canvas (design.md "Canvas"): pan, zoom, and select
 * only. Colours come from the `--xy-*` variables set in globals.css.
 */
export function FlowCanvas({ flow }: { flow: Pick<FlowDetail, "nodes" | "edges"> }) {
  const nodes = useMemo(() => toCanvasNodes(flow), [flow]);
  const edges = useMemo(() => toCanvasEdges(flow), [flow]);

  return (
    <section
      aria-label="Flow canvas"
      className="h-[28rem] min-w-0 overflow-hidden rounded-xl border border-border bg-background lg:h-[36rem]"
    >
      <ReactFlow
        className="fm-canvas"
        colorMode="dark"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultMarkerColor="var(--primary)"
        fitView
        fitViewOptions={FIT_VIEW}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panActivationKeyCode={null}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        aria-label="Flow diagram. Use Tab to move between nodes and Enter to open a node."
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </section>
  );
}
