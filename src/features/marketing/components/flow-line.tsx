"use client";

import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { createDotLoop } from "@/features/marketing/dot-loop";
import {
  buildRoute,
  dotPositions,
  lengthAtY,
  TIP_RATIO,
  updateLit,
  type FlowNode,
  type FlowRoute,
} from "@/features/marketing/flow-geometry";
import { useFlowStore } from "@/features/marketing/flow-store";
import { DESKTOP_QUERY, EASE_OUT, useMediaQuery, useMotionAllowed } from "@/features/marketing/hooks";

/**
 * The page is a workflow (design.md "Landing motion identity" items 1-3,
 * contract M2-M4): one coral line from the hero frame's output handle down
 * the left-gutter rail, a node per section, and data dots. Rendered by the
 * landing page inside the Hero-to-Final-CTA wrapper, only after mount.
 * Decorative: aria-hidden, no pointer events, behind all section content.
 */

/** Sections after the hero, in page order; each gets a node on the rail. */
export const FLOW_SECTION_IDS = ["how-it-works", "features", "security", "plans", "faq", "get-started"] as const;

const DOTS = { desktop: { count: 4, speed: 160, r: 2 }, phone: { count: 2, speed: 120, r: 1.5 } } as const;

type Geometry = { route: FlowRoute; width: number; height: number; vh: number; wrapperTop: number };

/**
 * Offset of `el` inside `root`, ignoring transforms (sums offsetTop and
 * offsetLeft up the offsetParent chain). If the chain does not reach `root`,
 * falls back to the difference of the two boxes.
 */
function offsetIn(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node !== null && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  if (node === root) return { x, y };
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top };
}

/** The node's anchor: the section's eyebrow, or its H2 when it has none. */
function anchorFor(id: string): HTMLElement | null {
  const section = document.getElementById(id);
  if (section === null) return null;
  return section.querySelector<HTMLElement>("[data-flow-anchor]") ?? document.getElementById(`${id}-heading`);
}

/** Measure function: the only place that reads layout (design.md "Measuring"). */
function measure(wrapper: HTMLElement): Geometry | null {
  const frame = wrapper.querySelector<HTMLElement>("[data-flow-handle]");
  const hero = wrapper.querySelector<HTMLElement>("[data-flow-hero]");
  if (frame === null || hero === null) return null;
  const frameAt = offsetIn(frame, wrapper);
  const heroAt = offsetIn(hero, wrapper);
  const nodes: { id: string; y: number }[] = [];
  for (const id of FLOW_SECTION_IDS) {
    const anchor = anchorFor(id);
    if (anchor === null) continue;
    const at = offsetIn(anchor, wrapper);
    const lineHeight = Number.parseFloat(window.getComputedStyle(anchor).lineHeight);
    const firstLine = Number.isFinite(lineHeight) ? Math.min(lineHeight, anchor.offsetHeight) : anchor.offsetHeight;
    nodes.push({ id, y: at.y + firstLine / 2 });
  }
  const width = wrapper.offsetWidth;
  const route = buildRoute({
    width,
    handle: { x: frameAt.x + frame.offsetWidth / 2, y: frameAt.y + frame.offsetHeight },
    heroBottom: heroAt.y + hero.offsetHeight,
    nodes,
  });
  return {
    route,
    width,
    height: wrapper.offsetHeight,
    vh: window.innerHeight,
    wrapperTop: wrapper.getBoundingClientRect().top + window.scrollY,
  };
}

/** Keeps the geometry current: ResizeObserver, fonts, viewport resize; one rAF batch. */
function useFlowGeometry(wrapperRef: RefObject<HTMLDivElement | null>): Geometry | null {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    let frame: number | null = null;
    let cancelled = false;
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!cancelled) setGeometry(measure(wrapper));
      });
    };
    schedule();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (observer !== null) {
      observer.observe(wrapper);
      for (const el of wrapper.querySelectorAll<HTMLElement>("[data-flow-hero], [data-flow-handle], section, details")) {
        observer.observe(el);
      }
    }
    void document.fonts?.ready.then(schedule);
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [wrapperRef]);
  return geometry;
}

export function FlowLine({ wrapperRef }: { wrapperRef: RefObject<HTMLDivElement | null> }) {
  const motionAllowed = useMotionAllowed();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const geometry = useFlowGeometry(wrapperRef);
  const route = geometry?.route ?? null;

  return (
    // One 200 ms opacity fade after mount (CSS animation, opacity only).
    <div
      data-flow-line={motionAllowed ? "draw" : "static"}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 animate-in overflow-hidden duration-200 fade-in-0"
    >
      <svg className="pointer-events-none absolute inset-0 size-full" fill="none" focusable="false">
        {route !== null && geometry !== null ? (
          motionAllowed ? (
            <DrawnFlow route={route} geometry={geometry} desktop={desktop} />
          ) : (
            <StaticFlow route={route} desktop={desktop} />
          )
        ) : null}
      </svg>
    </div>
  );
}

function Track({ d }: { d: string }) {
  return <path d={d} stroke="var(--fm-border)" strokeWidth={1} />;
}

/** Reduced motion: complete static line, every node lit, no pulse, no dots. */
function StaticFlow({ route, desktop }: { route: FlowRoute; desktop: boolean }) {
  const store = useFlowStore();
  useEffect(() => {
    store?.setLit(Object.fromEntries(route.nodes.map((n) => [n.id, true])));
  }, [store, route]);
  return (
    <>
      <Track d={route.d} />
      <path d={route.d} stroke="var(--fm-accent)" strokeWidth={desktop ? 1.5 : 1} strokeLinecap="round" />
      <FlowNodes nodes={route.nodes} lit={route.nodes.map(() => true)} pulse={null} desktop={desktop} />
    </>
  );
}

type Pulse = { index: number; key: number };

/** Motion on: drawn by scroll at the tip line, nodes light, dots run. */
function DrawnFlow({ route, geometry, desktop }: { route: FlowRoute; geometry: Geometry; desktop: boolean }) {
  const store = useFlowStore();
  const { scrollY } = useScroll();
  const geo = useMotionValue(geometry);
  useEffect(() => geo.set(geometry), [geo, geometry]);

  // Drawn length: the path length at the tip line's page position.
  const drawn = useTransform(() => {
    const g = geo.get();
    return lengthAtY(g.route, scrollY.get() + TIP_RATIO * g.vh - g.wrapperTop);
  });
  const pathLength = useTransform(() => {
    const total = geo.get().route.total;
    return total > 0 ? drawn.get() / total : 0;
  });
  // Hide the round cap dot while nothing is drawn.
  const drawnOpacity = useTransform(pathLength, (p) => (p > 0.0005 ? 1 : 0));

  const [lit, setLit] = useState<boolean[]>(() => route.nodes.map(() => false));
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const litRef = useRef<boolean[] | null>(null);
  const pulseKey = useRef(0);

  useEffect(() => {
    const apply = (s: number) => {
      const first = litRef.current === null;
      const result = updateLit(litRef.current ?? route.nodes.map(() => false), s, route.nodes.map((n) => n.s));
      if (!result.changed && !first) return;
      litRef.current = result.lit;
      setLit(result.lit);
      store?.setLit(Object.fromEntries(route.nodes.map((n, i) => [n.id, result.lit[i] === true])));
      // The first pass (page load, deep link) lights quietly.
      if (!first && result.pulse !== null) {
        pulseKey.current += 1;
        setPulse({ index: result.pulse, key: pulseKey.current });
      }
    };
    litRef.current = null;
    apply(drawn.get());
    return drawn.on("change", apply);
  }, [drawn, route, store]);

  return (
    <>
      <Track d={route.d} />
      <motion.path
        d={route.d}
        stroke="var(--fm-accent)"
        strokeWidth={desktop ? 1.5 : 1}
        strokeLinecap="round"
        style={{ pathLength, opacity: drawnOpacity }}
      />
      <FlowNodes nodes={route.nodes} lit={lit} pulse={pulse} desktop={desktop} onPulseEnd={() => setPulse(null)} />
      <FlowDots key={desktop ? "desktop" : "phone"} geo={geo} drawn={drawn} scrollY={scrollY} desktop={desktop} />
    </>
  );
}

/**
 * Section nodes: 10 px rounded squares (8 px on phones), lit in accent. A
 * pulse ring (scale 1 → 2.6, opacity 0.6 → 0, 600 ms) plays on `pulse`.
 */
export function FlowNodes({
  nodes,
  lit,
  pulse,
  desktop,
  onPulseEnd,
}: {
  nodes: readonly FlowNode[];
  lit: readonly boolean[];
  pulse: Pulse | null;
  desktop: boolean;
  onPulseEnd?: () => void;
}) {
  const size = desktop ? 10 : 8;
  const half = size / 2;
  return (
    <>
      {nodes.map((node, index) => {
        const on = lit[index] === true;
        return (
          <g key={node.id} data-flow-node={node.id} data-lit={on ? "true" : "false"} transform={`translate(${node.x} ${node.y})`}>
            <rect
              x={-half}
              y={-half}
              width={size}
              height={size}
              rx={3}
              fill={on ? "var(--fm-accent)" : "var(--fm-background)"}
              stroke={on ? "var(--fm-accent)" : "var(--fm-border)"}
              strokeWidth={1}
            />
            {pulse !== null && pulse.index === index ? (
              <motion.rect
                key={pulse.key}
                data-flow-pulse=""
                x={-half}
                y={-half}
                width={size}
                height={size}
                rx={3}
                stroke="var(--fm-accent)"
                strokeWidth={1}
                fill="none"
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 2.6, opacity: 0 }}
                transition={{ duration: 0.6, ease: EASE_OUT }}
                onAnimationComplete={onPulseEnd}
              />
            ) : null}
          </g>
        );
      })}
    </>
  );
}

/**
 * Data dots along the visible drawn part. Each frame only sets each dot's
 * transform and opacity from cached numbers; the loop stops while the tab is
 * hidden and while there is no visible run, and resumes on scroll.
 */
function FlowDots({
  geo,
  drawn,
  scrollY,
  desktop,
}: {
  geo: MotionValue<Geometry>;
  drawn: MotionValue<number>;
  scrollY: MotionValue<number>;
  desktop: boolean;
}) {
  const config = desktop ? DOTS.desktop : DOTS.phone;
  const refs = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    let travelled = 0;
    const loop = createDotLoop((dt) => {
      travelled += dt * config.speed;
      const g = geo.get();
      const states = dotPositions(g.route, scrollY.get() - g.wrapperTop, drawn.get(), travelled, config.count);
      let any = false;
      states.forEach((state, i) => {
        const el = refs.current[i];
        if (!el) return;
        if (state === null) {
          el.style.opacity = "0";
          return;
        }
        any = true;
        el.style.transform = `translate(${state.x}px, ${state.y}px)`;
        el.style.opacity = String(state.opacity);
      });
      return any;
    });
    loop.start();
    const offScroll = scrollY.on("change", loop.start);
    const offGeo = geo.on("change", loop.start);
    return () => {
      offScroll();
      offGeo();
      loop.destroy();
    };
  }, [config, geo, drawn, scrollY]);

  return (
    <>
      {Array.from({ length: config.count }, (_, i) => (
        <circle
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          data-flow-dot=""
          r={config.r}
          cx={0}
          cy={0}
          fill="var(--fm-accent)"
          style={{ opacity: 0 }}
        />
      ))}
    </>
  );
}

export type { Pulse as FlowPulse };
