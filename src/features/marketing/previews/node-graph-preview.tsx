"use client";

import { motion } from "motion/react";

import { FlowNodeCardBody, FlowNodeTriggerTag } from "@/features/flows/components/flow-node-card-body";
import { EASE_OUT } from "@/features/marketing/hooks";
import {
  PREVIEW_EDGES,
  PREVIEW_LAYOUT_LANDSCAPE,
  PREVIEW_LAYOUT_PORTRAIT,
  PREVIEW_NODES,
  type PreviewGraphLayout,
} from "@/features/marketing/preview-data";
import { cn } from "@/lib/utils";

/**
 * Small node graph from sample data, drawn with the flow canvas's node card
 * body and inline SVG edges (no `@xyflow/react`, F8/F10). `draw` animates
 * the edges in with SVG `pathLength` while `active`; otherwise edges are
 * static and fully drawn (server render, reduced motion). Two layouts:
 * left-to-right from 460 px of container width, top-to-bottom below it.
 */

type EdgeGeometry = {
  id: string;
  d: string;
  arrow: string;
  label?: string;
  labelX: number;
  labelY: number;
};

function edgesFor(layout: PreviewGraphLayout): EdgeGeometry[] {
  const { nodeWidth: nw, nodeHeight: nh, positions } = layout;
  return PREVIEW_EDGES.map((edge) => {
    const from = positions[edge.from]!;
    const to = positions[edge.to]!;
    if (layout.direction === "right") {
      const [x1, y1, x2, y2] = [from.x + nw, from.y + nh / 2, to.x - 4, to.y + nh / 2];
      const mid = (x1 + x2) / 2;
      return {
        id: `${edge.from}-${edge.to}`,
        d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
        arrow: `M ${x2 - 6} ${y2 - 4} L ${x2} ${y2} L ${x2 - 6} ${y2 + 4}`,
        label: edge.label,
        labelX: mid,
        labelY: (y1 + y2) / 2,
      };
    }
    const [x1, y1, x2, y2] = [from.x + nw / 2, from.y + nh, to.x + nw / 2, to.y - 4];
    const mid = (y1 + y2) / 2;
    return {
      id: `${edge.from}-${edge.to}`,
      d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
      arrow: `M ${x2 - 4} ${y2 - 6} L ${x2} ${y2} L ${x2 + 4} ${y2 - 6}`,
      label: edge.label,
      labelX: (x1 + x2) / 2,
      labelY: mid,
    };
  });
}

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

export function NodeGraphPreview({ edges = "static", active = true }: { edges?: "static" | "draw"; active?: boolean }) {
  return (
    <div className="@container w-full">
      <GraphLayout layout={PREVIEW_LAYOUT_LANDSCAPE} edges={edges} active={active} className="hidden @min-[460px]:block" />
      <GraphLayout
        layout={PREVIEW_LAYOUT_PORTRAIT}
        edges={edges}
        active={active}
        className="mx-auto block max-w-[340px] @min-[460px]:hidden"
      />
    </div>
  );
}

function GraphLayout({
  layout,
  edges,
  active,
  className,
}: {
  layout: PreviewGraphLayout;
  edges: "static" | "draw";
  active: boolean;
  className?: string;
}) {
  const { width: W, height: H, nodeWidth: NW, nodeHeight: NH } = layout;
  const geometry = edgesFor(layout);
  return (
    <div className={cn("relative w-full", className)} style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" fill="none" aria-hidden="true">
        {geometry.map((edge, index) =>
          edges === "draw" ? (
            <g key={edge.id}>
              <motion.path
                d={edge.d}
                stroke="var(--fm-accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: active ? 1 : 0 }}
                transition={{ duration: 0.6, delay: active ? 0.15 + index * 0.18 : 0, ease: EASE_OUT }}
              />
              <motion.path
                d={edge.arrow}
                stroke="var(--fm-accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: active ? 1 : 0 }}
                transition={{ duration: 0.2, delay: active ? 0.6 + index * 0.18 : 0 }}
              />
            </g>
          ) : (
            <g key={edge.id}>
              <path d={edge.d} stroke="var(--fm-accent)" strokeWidth={1.5} strokeLinecap="round" />
              <path
                d={edge.arrow}
                stroke="var(--fm-accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ),
        )}
      </svg>
      {geometry.map((edge) =>
        edge.label ? (
          <span
            key={`${edge.id}-label`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-background px-1 font-mono text-[10px] leading-4 text-muted-foreground"
            style={{ left: pct(edge.labelX, W), top: pct(edge.labelY, H) }}
          >
            {edge.label}
          </span>
        ) : null,
      )}
      {PREVIEW_NODES.map((node) => {
        const pos = layout.positions[node.key]!;
        return (
          <div
            key={node.key}
            className="absolute"
            style={{ left: pct(pos.x, W), top: pct(pos.y, H), width: pct(NW, W), height: pct(NH, H) }}
          >
            <div className="flex size-full items-center gap-2 rounded-xl border border-border bg-card px-2.5 text-card-foreground">
              <FlowNodeCardBody label={node.label} nodeType={node.nodeType} needsCredential={node.needsCredential} />
            </div>
            {node.isTrigger ? <FlowNodeTriggerTag /> : null}
          </div>
        );
      })}
    </div>
  );
}
