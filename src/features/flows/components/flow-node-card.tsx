"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import { FlowNodeCardBody, FlowNodeTriggerTag } from "@/features/flows/components/flow-node-card-body";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  handleOffset,
  sourceHandleId,
  targetHandleId,
  type FlowCanvasNode,
} from "@/features/flows/graph";
import { cn } from "@/lib/utils";
import { useFlowCanvasStore } from "@/stores/flow-canvas";

/**
 * Read-only node card. The card is a real button, so nodes are reachable with
 * Tab in graph order and Enter or Space opens the inspector. Every string from
 * the flow is rendered as plain text.
 */
export function FlowNodeCard({ data }: NodeProps<FlowCanvasNode>) {
  const { node } = data;
  const selected = useFlowCanvasStore((state) => state.selectedNodeKey === node.key);
  const selectNode = useFlowCanvasStore((state) => state.selectNode);

  return (
    <div className="relative" style={{ width: NODE_WIDTH, height: NODE_HEIGHT }} data-node-key={node.key}>
      {Array.from({ length: node.inputs }, (_, i) => (
        <Handle
          key={targetHandleId(i)}
          id={targetHandleId(i)}
          type="target"
          position={Position.Left}
          isConnectable={false}
          style={{ top: handleOffset(i, node.inputs) }}
        />
      ))}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={selected}
        data-selected={selected ? "true" : undefined}
        onClick={() => selectNode(node.key)}
        onKeyDown={(event) => {
          // Explicit so Enter and Space always open the inspector, whatever the canvas does with keys.
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectNode(node.key);
          }
        }}
        className={cn(
          "nodrag nopan flex size-full cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 text-left text-card-foreground transition-colors hover:bg-secondary",
          selected ? "border-primary" : "border-border",
        )}
      >
        <FlowNodeCardBody label={node.label} nodeType={node.nodeType} needsCredential={node.credential !== null} />
      </button>
      {node.isTrigger ? <FlowNodeTriggerTag /> : null}
      {Array.from({ length: node.outputs }, (_, i) => (
        <Handle
          key={sourceHandleId(i)}
          id={sourceHandleId(i)}
          type="source"
          position={Position.Right}
          isConnectable={false}
          style={{ top: handleOffset(i, node.outputs) }}
        />
      ))}
    </div>
  );
}
