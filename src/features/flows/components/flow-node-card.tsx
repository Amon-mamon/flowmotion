"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { KeyRoundIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { NodeIcon } from "@/features/flows/components/node-icon";
import { FLOW_COPY } from "@/features/flows/copy";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  handleOffset,
  shortNodeType,
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
          "flex size-full cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 text-left text-card-foreground transition-colors hover:bg-secondary",
          selected ? "border-primary" : "border-border",
        )}
      >
        <NodeIcon nodeType={node.nodeType} className="size-5 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{node.label}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{shortNodeType(node.nodeType)}</span>
        </span>
        {node.credential !== null ? (
          <span className="shrink-0 text-muted-foreground" data-needs-credential="true">
            <KeyRoundIcon aria-hidden="true" className="size-4" />
            <span className="sr-only">Needs a credential</span>
          </span>
        ) : null}
      </button>
      {node.isTrigger ? (
        <Badge
          variant="outline"
          className="pointer-events-none absolute -top-2.5 left-3 rounded-lg border-primary bg-background text-primary"
        >
          {FLOW_COPY.triggerTag}
        </Badge>
      ) : null}
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
