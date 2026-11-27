"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

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
 * static and fully drawn (server render, reduced motion). With `progress`
 * (the desktop story, design.md "Landing motion identity" item 7) the nodes
 * scale in over p 0.69 → 0.81 and the edges draw over p 0.78 → 0.90, so
 * scrolling up plays it backwards. Two layouts: left-to-right from 460 px of
 * container width, top-to-bottom below it.
 */

/** Story progress windows for the graph (design.md item 7). */
const NODES_IN: [number, number] = [0.69, 0.81];
const EDGES_IN: [number, number] = [0.78, 0.9];

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
    // Same column in a left-to-right layout: a short vertical edge downwards.
    if (layout.direction === "right" && Math.abs(to.x - from.x) < nw) {
      const [x, y1, y2] = [from.x + nw / 2, from.y + nh, to.y - 4];
      return {
        id: `${edge.from}-${edge.to}`,
        d: `M ${x} ${y1} L ${x} ${y2}`,
        arrow: `M ${x - 4} ${y2 - 6} L ${x} ${y2} L ${x + 4} ${y2 - 6}`,
        label: edge.label,
        labelX: x,
        labelY: (y1 + y2) / 2,
      };
    }
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

export function NodeGraphPreview({
  edges = "static",
  active = true,
  progress,
}: {
  edges?: "static" | "draw";
  active?: boolean;
  progress?: MotionValue<number>;
}) {
  return (
    <div className="@container w-full">
      <GraphLayout
        layout={PREVIEW_LAYOUT_LANDSCAPE}
        edges={edges}
        active={active}
        progress={progress}
        className="hidden @min-[460px]:block"
      />
      <GraphLayout
        layout={PREVIEW_LAYOUT_PORTRAIT}
        edges={edges}
        active={active}
        progress={progress}
        className="mx-auto block max-w-[340px] @min-[460px]:hidden"
      />
    </div>
  );
}

function ProgressEdge({ edge, progress }: { edge: EdgeGeometry; progress: MotionValue<number> }) {
  const pathLength = useTransform(progress, EDGES_IN, [0, 1], { clamp: true });
  const arrow = useTransform(progress, [EDGES_IN[1] - 0.02, EDGES_IN[1]], [0, 1], { clamp: true });
  return (
    <g>
      <motion.path d={edge.d} stroke="var(--fm-accent)" strokeWidth={1.5} strokeLinecap="round" style={{ pathLength }} />
      <motion.path
        d={edge.arrow}
        stroke="var(--fm-accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: arrow }}
      />
    </g>
  );
}

/** Node or label that scales 0.6 → 1 and fades in with story progress. */
function ProgressIn({
  progress,
  window: range,
  className,
  style,
  children,
}: {
  progress: MotionValue<number>;
  window: [number, number];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const opacity = useTransform(progress, range, [0, 1], { clamp: true });
  const scale = useTransform(progress, range, [0.6, 1], { clamp: true });
  return (
    <motion.div className={className} style={{ ...style, opacity, scale }}>
      {children}
    </motion.div>
  );
}

function GraphLayout({
  layout,
  edges,
  active,
  progress,
  className,
}: {
  layout: PreviewGraphLayout;
  edges: "static" | "draw";
  active: boolean;
  progress?: MotionValue<number>;
  className?: string;
}) {
  const { width: W, height: H, nodeWidth: NW, nodeHeight: NH } = layout;
  const geometry = edgesFor(layout);
  return (
    <div className={cn("relative w-full", className)} style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" fill="none" aria-hidden="true">
        {geometry.map((edge, index) =>
          progress !== undefined ? (
            <ProgressEdge key={edge.id} edge={edge} progress={progress} />
          ) : edges === "draw" ? (
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
      {geometry.map((edge) => {
        if (!edge.label) return null;
        const label = (
          <span className="block -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-background px-1 font-mono text-[10px] leading-4 text-muted-foreground">
            {edge.label}
          </span>
        );
        const style = { left: pct(edge.labelX, W), top: pct(edge.labelY, H) };
        return progress !== undefined ? (
          <ProgressIn key={`${edge.id}-label`} progress={progress} window={EDGES_IN} className="absolute" style={style}>
            {label}
          </ProgressIn>
        ) : (
          <span key={`${edge.id}-label`} className="absolute" style={style}>
            {label}
          </span>
        );
      })}
      {PREVIEW_NODES.map((node) => {
        const pos = layout.positions[node.key]!;
        const style = { left: pct(pos.x, W), top: pct(pos.y, H), width: pct(NW, W), height: pct(NH, H) };
        const body = (
          <>
            <div className="flex size-full items-center gap-2 rounded-xl border border-border bg-card px-2.5 text-card-foreground">
              <FlowNodeCardBody label={node.label} nodeType={node.nodeType} needsCredential={node.needsCredential} />
            </div>
            {node.isTrigger ? <FlowNodeTriggerTag /> : null}
          </>
        );
        return progress !== undefined ? (
          <ProgressIn key={node.key} progress={progress} window={NODES_IN} className="absolute" style={style}>
            {body}
          </ProgressIn>
        ) : (
          <div key={node.key} className="absolute" style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
