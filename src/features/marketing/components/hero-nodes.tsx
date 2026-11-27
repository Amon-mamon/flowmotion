"use client";

import {
  animate,
  cubicBezier,
  motion,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useState, type RefObject } from "react";

import { NodeIcon } from "@/features/flows/components/node-icon";
import { EASE_OUT } from "@/features/marketing/hooks";

/**
 * Hero assembly (design.md "Landing motion identity" item 5, contract M6):
 * four node chips scattered in the hero's side space join into a connected
 * row above the product frame as scrolling starts. Rendered only after mount
 * and only from 1280 px. Decorative: aria-hidden, no pointer events.
 */

export const HERO_CHIPS = [
  { type: "n8n-nodes-base.webhook", at: [0.06, 0.2], rotate: -8, depth: 0.4 },
  { type: "n8n-nodes-base.scheduleTrigger", at: [0.12, 0.7], rotate: 6, depth: 1 },
  { type: "n8n-nodes-base.httpRequest", at: [0.88, 0.35], rotate: -5, depth: 0.7 },
  { type: "n8n-nodes-base.slack", at: [0.94, 0.75], rotate: 9, depth: 0.5 },
] as const;

const CHIP = 40;
const GAP = 48;
const ROW_ABOVE_FRAME = 48;
const PARALLAX = 12;
const ease = cubicBezier(...EASE_OUT);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type HeroGeometry = { width: number; height: number; frameTop: number };

/** Chip centres in hero coordinates, scattered and assembled. */
export function chipPositions(g: HeroGeometry) {
  const rowWidth = HERO_CHIPS.length * CHIP + (HERO_CHIPS.length - 1) * GAP;
  const firstX = g.width / 2 - rowWidth / 2 + CHIP / 2;
  const rowY = g.frameTop - ROW_ABOVE_FRAME;
  return HERO_CHIPS.map((chip, i) => ({
    scattered: { x: chip.at[0] * g.width, y: chip.at[1] * g.frameTop },
    assembled: { x: firstX + i * (CHIP + GAP), y: rowY },
  }));
}

/** Measure function: hero size and the product frame's top (ResizeObserver only). */
function useHeroGeometry(heroRef: RefObject<HTMLElement | null>): HeroGeometry | null {
  const [geometry, setGeometry] = useState<HeroGeometry | null>(null);
  useEffect(() => {
    const hero = heroRef.current;
    if (hero === null) return;
    let frame: number | null = null;
    let cancelled = false;
    const read = () => {
      frame = null;
      if (cancelled) return;
      const handle = hero.querySelector<HTMLElement>("[data-flow-handle]");
      let top = 0;
      for (let n: HTMLElement | null = handle; n !== null && n !== hero; ) {
        top += n.offsetTop;
        n = n.offsetParent instanceof HTMLElement ? n.offsetParent : null;
      }
      setGeometry({ width: hero.offsetWidth, height: hero.offsetHeight, frameTop: top });
    };
    const schedule = () => {
      if (!cancelled && frame === null) frame = window.requestAnimationFrame(read);
    };
    schedule();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(hero);
    void document.fonts?.ready.then(schedule);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [heroRef]);
  return geometry;
}

export function HeroNodes({
  heroRef,
  motionAllowed,
  parallax,
}: {
  heroRef: RefObject<HTMLElement | null>;
  motionAllowed: boolean;
  /** Mouse parallax: motion allowed and a fine hovering pointer. */
  parallax: boolean;
}) {
  const geometry = useHeroGeometry(heroRef);
  return (
    <div aria-hidden="true" data-hero-nodes="" className="pointer-events-none absolute inset-0 -z-[5]">
      {geometry === null ? null : motionAllowed ? (
        <MovingChips heroRef={heroRef} geometry={geometry} parallax={parallax} />
      ) : (
        <StaticChips geometry={geometry} />
      )}
    </div>
  );
}

function ChipBox({ type }: { type: string }) {
  return (
    <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-card">
      <NodeIcon nodeType={type} className="size-[18px] text-muted-foreground" />
    </span>
  );
}

function edgePaths(g: HeroGeometry) {
  const pos = chipPositions(g);
  return pos.slice(0, -1).map((from, i) => {
    const to = pos[i + 1]!;
    const x1 = from.assembled.x + CHIP / 2;
    const x2 = to.assembled.x - CHIP / 2 - 4;
    const y = from.assembled.y;
    return {
      d: `M ${x1} ${y} L ${x2} ${y}`,
      arrow: `M ${x2 - 6} ${y - 4} L ${x2} ${y} L ${x2 - 6} ${y + 4}`,
    };
  });
}

/** Reduced motion: the assembled row with its edges, static. */
function StaticChips({ geometry }: { geometry: HeroGeometry }) {
  const pos = chipPositions(geometry);
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" fill="none" data-hero-edges="">
        {edgePaths(geometry).map((edge, i) => (
          <g key={i} stroke="var(--fm-accent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d={edge.d} />
            <path d={edge.arrow} />
          </g>
        ))}
      </svg>
      {HERO_CHIPS.map((chip, i) => (
        <div
          key={chip.type}
          data-hero-chip={i}
          className="pointer-events-none absolute top-0 left-0"
          style={{ transform: `translate(${pos[i]!.assembled.x - CHIP / 2}px, ${pos[i]!.assembled.y - CHIP / 2}px)` }}
        >
          <ChipBox type={chip.type} />
        </div>
      ))}
    </>
  );
}

function MovingChips({
  heroRef,
  geometry,
  parallax,
}: {
  heroRef: RefObject<HTMLElement | null>;
  geometry: HeroGeometry;
  parallax: boolean;
}) {
  // Same scroll range as the hero frame tilt.
  const { scrollYProgress, scrollY } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const assembly = useTransform(scrollYProgress, [0, 0.25], [0, 1], { clamp: true, ease });
  const edgeDraw = useTransform(scrollYProgress, [0.15, 0.3], [0, 1], { clamp: true });
  const arrowOpacity = useTransform(scrollYProgress, [0.28, 0.3], [0, 1], { clamp: true });
  // Hide the round cap dot while nothing is drawn.
  const edgeVisible = useTransform(edgeDraw, (v) => (v > 0.001 ? 1 : 0));

  const intro = useMotionValue(0);
  useEffect(() => {
    const controls = animate(intro, 1, { duration: 0.6, ease: EASE_OUT });
    return () => controls.stop();
  }, [intro]);

  // Pointer offset from the hero centre, normalised −1..1, smoothed.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const spring = { stiffness: 150, damping: 20, mass: 0.5 };
  const px = useSpring(pointerX, spring);
  const py = useSpring(pointerY, spring);
  const heroInView = useInView(heroRef);

  useEffect(() => {
    const hero = heroRef.current;
    if (!parallax || !heroInView || hero === null) return;
    let box: DOMRect | null = null;
    const invalidate = () => {
      box = null;
    };
    const onEnter = () => {
      box = hero.getBoundingClientRect();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      box ??= hero.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      pointerX.set(Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1)));
      pointerY.set(Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1)));
    };
    const onLeave = () => {
      pointerX.set(0);
      pointerY.set(0);
    };
    hero.addEventListener("pointerenter", onEnter, { passive: true });
    hero.addEventListener("pointermove", onMove, { passive: true });
    hero.addEventListener("pointerleave", onLeave, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    const offScroll = scrollY.on("change", invalidate);
    return () => {
      hero.removeEventListener("pointerenter", onEnter);
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", invalidate);
      offScroll();
      pointerX.set(0);
      pointerY.set(0);
    };
  }, [parallax, heroInView, heroRef, pointerX, pointerY, scrollY]);

  const pos = chipPositions(geometry);
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" fill="none" data-hero-edges="">
        {edgePaths(geometry).map((edge, i) => (
          <g key={i} stroke="var(--fm-accent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <motion.path d={edge.d} style={{ pathLength: edgeDraw, opacity: edgeVisible }} />
            <motion.path d={edge.arrow} style={{ opacity: arrowOpacity }} />
          </g>
        ))}
      </svg>
      {HERO_CHIPS.map((chip, i) => (
        <MovingChip
          key={chip.type}
          index={i}
          type={chip.type}
          rotate={chip.rotate}
          depth={chip.depth}
          from={pos[i]!.scattered}
          to={pos[i]!.assembled}
          assembly={assembly}
          intro={intro}
          px={px}
          py={py}
        />
      ))}
    </>
  );
}

function MovingChip({
  index,
  type,
  rotate,
  depth,
  from,
  to,
  assembly,
  intro,
  px,
  py,
}: {
  index: number;
  type: string;
  rotate: number;
  depth: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  assembly: MotionValue<number>;
  intro: MotionValue<number>;
  px: MotionValue<number>;
  py: MotionValue<number>;
}) {
  const x = useTransform(() => {
    const a = assembly.get();
    return lerp(from.x, to.x, a) + px.get() * PARALLAX * depth * (1 - a) - CHIP / 2;
  });
  const y = useTransform(() => {
    const a = assembly.get();
    return lerp(from.y, to.y, a) + py.get() * PARALLAX * depth * (1 - a) - CHIP / 2;
  });
  const r = useTransform(assembly, (a) => lerp(rotate, 0, a));
  const scale = useTransform(assembly, (a) => lerp(0.9, 1, a));
  const opacity = useTransform(() => intro.get() * lerp(0.7, 1, assembly.get()));
  return (
    <motion.div
      data-hero-chip={index}
      className="pointer-events-none absolute top-0 left-0"
      style={{ x, y, rotate: r, scale, opacity }}
    >
      <ChipBox type={type} />
    </motion.div>
  );
}
