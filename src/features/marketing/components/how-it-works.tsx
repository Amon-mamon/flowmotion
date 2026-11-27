"use client";

import { motion, useInView, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { HOW_IT_WORKS, PREVIEW_LABELS, STEP_PREFIX, type StepKey } from "@/features/marketing/copy";
import { bodyClass, ComingSoonTag, containerClass, h3Class, sectionClass } from "@/features/marketing/components/primitives";
import { SectionIntro } from "@/features/marketing/components/section-intro";
import { useEntrance } from "@/features/marketing/entrance";
import { DESKTOP_QUERY, useMediaQuery, useMotionAllowed, useMounted } from "@/features/marketing/hooks";
import { NodeGraphPreview } from "@/features/marketing/previews/node-graph-preview";
import { RecommendationCardPreview, RecommendationsPreview, RepoTreePreview } from "@/features/marketing/previews/parts";
import { ProductFrame } from "@/features/marketing/previews/preview-root";
import { PREVIEW_BRANCH, PREVIEW_RECOMMENDATIONS, PREVIEW_REPO } from "@/features/marketing/preview-data";
import { isFlowGenerationLive } from "@/features/marketing/readiness";
import { cn } from "@/lib/utils";

export const steps = HOW_IT_WORKS.steps;
type Step = (typeof steps)[number];

/**
 * How it works (design.md item 4, F5, M8).
 *
 * The page layout is decided by CSS media queries, never by a JS check after
 * mount (RL-1): from 768 px with `prefers-reduced-motion: no-preference` the
 * story is two columns (four ~70vh text steps and a CSS-sticky visual
 * column); otherwise four stacked panels (text, then its visual). The server
 * HTML holds both the step visuals and the sticky column, so the section has
 * the same height before and after hydration and `/#security` or `/#faq`
 * land where they should.
 *
 * JS only picks the behaviour (`data-story-layout`):
 * - `sticky` (motion allowed, 768 px and up): the visual is driven by scroll
 *   progress `p` over the step list and plays backwards when scrolling up.
 * - `stacked` with motion (phones): panels below the fold fade and rise once.
 * - `stacked` static (server render, hydration, reduced motion).
 */
export function HowItWorks() {
  const reduced = usePrefersReducedMotion();
  const motionAllowed = useMotionAllowed();
  const mounted = useMounted();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const layout = motionAllowed && desktop ? "sticky" : "stacked";

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      data-motion={reduced ? "reduced" : "full"}
      data-story-layout={layout}
      className={sectionClass}
    >
      <div className={containerClass}>
        <SectionIntro
          id="how-it-works"
          eyebrow={HOW_IT_WORKS.eyebrow}
          heading={HOW_IT_WORKS.heading}
          lead={HOW_IT_WORKS.lead}
        />
        <Story
          layout={layout}
          animatePanels={motionAllowed && layout === "stacked"}
          // Before mount both structures exist (CSS shows one); after mount
          // the hidden one is dropped (it is display:none, so nothing moves).
          showInline={!mounted || layout === "stacked"}
          showColumn={!mounted || layout === "sticky"}
        />
      </div>
    </section>
  );
}

/** Two columns only from 768 px with motion allowed by the OS (CSS decides). */
const storyGridClass =
  "mt-16 md:mt-20 md:motion-safe:mt-8 md:motion-safe:grid md:motion-safe:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:motion-safe:gap-16";
const storyListClass = "flex flex-col gap-16 md:gap-24 md:motion-safe:gap-0";
/** Stacked panel row; in the two-column story a ~70vh text step. */
export const storyStepClass =
  "relative grid list-none grid-cols-1 items-center gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-16 md:motion-safe:flex md:motion-safe:min-h-[70vh] md:motion-safe:pl-8";

function Story({
  layout,
  animatePanels,
  showInline,
  showColumn,
}: {
  layout: "sticky" | "stacked";
  animatePanels: boolean;
  showInline: boolean;
  showColumn: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const sticky = layout === "sticky";
  return (
    <div className={storyGridClass}>
      <ol ref={listRef} className={storyListClass}>
        {steps.map((step, index) => (
          <StoryStep
            key={step.key}
            step={step}
            index={index}
            active={sticky ? active === index : undefined}
            onActive={setActive}
            animate={animatePanels}
            showVisual={showInline}
          />
        ))}
      </ol>
      {showColumn ? (
        <div className="hidden md:motion-safe:block">
          {sticky ? <StickyVisual listRef={listRef} /> : <ColumnBeforeMount />}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Step label, title, and body. `active` is set only in the sticky variant:
 * title and body are white and the inactive steps fade to 64% opacity, which
 * reads as `--muted` on the page background (opacity is the only animated
 * property).
 */
function StepText({ step, index, active }: { step: Step; index: number; active?: boolean }) {
  const live = isFlowGenerationLive();
  const sticky = active !== undefined;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("fm-mono-label", sticky && active ? "text-primary" : "text-muted-2")}>{step.label}</span>
        {step.comingSoon && !live ? <ComingSoonTag /> : null}
      </div>
      <div
        className={cn(
          "flex flex-col gap-4",
          sticky && "transition-opacity duration-500 motion-reduce:transition-none",
          sticky && (active ? "opacity-100" : "opacity-[0.64]"),
        )}
      >
        <h3 className={h3Class}>
          <span className="sr-only">
            {STEP_PREFIX} {index + 1}:{" "}
          </span>
          {step.title}
        </h3>
        <p className={cn(bodyClass, sticky && "text-foreground")}>{step.body}</p>
      </div>
    </div>
  );
}

function StoryStep({
  step,
  index,
  active,
  onActive,
  animate,
  showVisual,
}: {
  step: Step;
  index: number;
  active: boolean | undefined;
  onActive: (index: number) => void;
  animate: boolean;
  showVisual: boolean;
}) {
  const { ref, style } = useEntrance<HTMLLIElement>(animate, { y: 16 });
  // Sticky: active when the step's text crosses the middle of the viewport.
  const crossing = useInView(ref, { margin: "-50% 0px -50% 0px" });
  // Phones: step 04's edges draw once the panel is in view.
  const seen = useInView(ref, { once: true, amount: 0.25 });
  const sticky = active !== undefined;
  useEffect(() => {
    if (sticky && crossing) onActive(index);
  }, [sticky, crossing, index, onActive]);

  return (
    <motion.li
      ref={ref}
      data-story-step={step.key}
      data-active={sticky ? (active ? "true" : "false") : undefined}
      className={storyStepClass}
      style={style}
    >
      {/* No step line beside the story: the page's flow line is the one coral line (RM-4). */}
      <StepText step={step} index={index} active={active} />
      {showVisual ? (
        <div className="md:motion-safe:hidden">
          <StepVisual stepKey={step.key} edges={animate ? "draw" : "static"} active={animate ? seen : true} />
        </div>
      ) : null}
    </motion.li>
  );
}

const FRAME_PATH: Readonly<Record<StepKey, string>> = {
  connect: `${PREVIEW_REPO} · ${PREVIEW_BRANCH}`,
  scan: `${PREVIEW_REPO} · ${PREVIEW_LABELS.stepFrame.scan}`,
  recommend: `${PREVIEW_REPO} · ${PREVIEW_LABELS.stepFrame.recommend}`,
  generate: `${PREVIEW_REPO} · ${PREVIEW_LABELS.stepFrame.generate}`,
};

function StepVisual({ stepKey, edges, active }: { stepKey: StepKey; edges: "static" | "draw"; active: boolean }) {
  return (
    <ProductFrame name={`step-${stepKey}`} path={FRAME_PATH[stepKey]}>
      {stepKey === "connect" ? <RepoTreePreview mode="tree" /> : null}
      {stepKey === "scan" ? <RepoTreePreview mode="scan" /> : null}
      {stepKey === "recommend" ? <RecommendationsPreview count={3} /> : null}
      {stepKey === "generate" ? (
        <div className="py-6">
          <NodeGraphPreview edges={edges} active={active} />
        </div>
      ) : null}
    </ProductFrame>
  );
}

/* ---------- the sticky visual column ---------- */

function StickyColumn({ children }: { children: ReactNode }) {
  return (
    <div data-story-visual="sticky" className="sticky top-24 will-change-transform" style={{ perspective: "1200px" }}>
      <div className="relative h-[540px]">{children}</div>
    </div>
  );
}

/** Server render and hydration: the first state only, flat and visible. */
function ColumnBeforeMount() {
  return (
    <StickyColumn>
      <div data-story-visual-state="connect" className="absolute inset-x-0 top-0">
        <StepVisual stepKey="connect" edges="static" active />
      </div>
    </StickyColumn>
  );
}

/**
 * Desktop story (design.md "Landing motion identity" item 7). `p` is the
 * scroll progress over the step list (`start center` → `end center`); state
 * i owns [i/4, (i+1)/4] and the states crossfade over ±0.04 around each
 * boundary. Inside: scanner bar, rows to cards, cards to graph.
 */
function StickyVisual({ listRef }: { listRef: RefObject<HTMLOListElement | null> }) {
  const { scrollYProgress: p } = useScroll({ target: listRef, offset: ["start center", "end center"] });
  return (
    <StickyColumn>
      {steps.map((step, index) => (
        <StoryState key={step.key} index={index} stepKey={step.key} p={p} />
      ))}
    </StickyColumn>
  );
}

const W = 0.04;

/** Crossfade input range for state i (opacity, the 12 px rise, and the rotateX settle). */
function crossfade(index: number): { input: number[]; on: number[] } {
  if (index === 0) return { input: [0.25 - W, 0.25 + W], on: [1, 0] };
  if (index === steps.length - 1) return { input: [0.75 - W, 0.75 + W], on: [0, 1] };
  const a = index / 4;
  const b = (index + 1) / 4;
  return { input: [a - W, a + W, b - W, b + W], on: [0, 1, 1, 0] };
}

function StoryState({ index, stepKey, p }: { index: number; stepKey: StepKey; p: MotionValue<number> }) {
  const { input, on } = crossfade(index);
  const opacity = useTransform(p, input, on, { clamp: true });
  const y = useTransform(p, input, on.map((v) => (1 - v) * 12), { clamp: true });
  const rotateX = useTransform(p, input, on.map((v) => (1 - v) * 6), { clamp: true });
  return (
    <motion.div
      data-story-visual-state={stepKey}
      className="absolute inset-x-0 top-0"
      style={{ opacity, y, rotateX, transformOrigin: "50% 100%" }}
    >
      <ProductFrame name={`step-${stepKey}`} path={FRAME_PATH[stepKey]}>
        {stepKey === "connect" ? <RepoTreePreview mode="tree" /> : null}
        {stepKey === "scan" ? <ScanOut p={p} /> : null}
        {stepKey === "recommend" ? <CardsInOut p={p} /> : null}
        {stepKey === "generate" ? (
          <div className="py-6">
            <NodeGraphPreview progress={p} />
          </div>
        ) : null}
      </ProductFrame>
    </motion.div>
  );
}

/** Scan state: scanner bar and statuses; the rows leave upwards over p 0.44 → 0.56. */
function ScanOut({ p }: { p: MotionValue<number> }) {
  const y = useTransform(p, [0.44, 0.56], [0, -24], { clamp: true });
  const scale = useTransform(p, [0.44, 0.56], [1, 0.96], { clamp: true });
  const opacity = useTransform(p, [0.44, 0.56], [1, 0], { clamp: true });
  return (
    <motion.div style={{ y, scale, opacity }}>
      <RepoTreePreview mode="scan" scanProgress={p} />
    </motion.div>
  );
}

/** Recommend state: cards rise in (0.02 apart), then shrink to the centre over p 0.69 → 0.81. */
function CardsInOut({ p }: { p: MotionValue<number> }) {
  const scale = useTransform(p, [0.69, 0.81], [1, 0.6], { clamp: true });
  const opacity = useTransform(p, [0.69, 0.81], [1, 0], { clamp: true });
  return (
    <motion.div className="flex flex-col gap-3" style={{ scale, opacity, transformOrigin: "50% 50%" }}>
      {PREVIEW_RECOMMENDATIONS.slice(0, 3).map((rec, index) => (
        <CardIn key={rec.title} p={p} index={index}>
          <RecommendationCardPreview recommendation={rec} />
        </CardIn>
      ))}
    </motion.div>
  );
}

function CardIn({ p, index, children }: { p: MotionValue<number>; index: number; children: ReactNode }) {
  const range = [0.44 + index * 0.02, 0.56 + index * 0.02];
  const y = useTransform(p, range, [24, 0], { clamp: true });
  const scale = useTransform(p, range, [0.96, 1], { clamp: true });
  const opacity = useTransform(p, range, [0, 1], { clamp: true });
  return <motion.div style={{ y, scale, opacity }}>{children}</motion.div>;
}
