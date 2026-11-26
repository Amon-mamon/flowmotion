"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { HOW_IT_WORKS, type StepKey } from "@/features/marketing/copy";
import {
  bodyClass,
  ComingSoonTag,
  containerClass,
  h3Class,
  sectionClass,
  SectionIntro,
} from "@/features/marketing/components/primitives";
import { DESKTOP_QUERY, EASE_OUT, useMediaQuery, useMotionAllowed } from "@/features/marketing/hooks";
import { NodeGraphPreview } from "@/features/marketing/previews/node-graph-preview";
import { RecommendationsPreview, RepoTreePreview } from "@/features/marketing/previews/parts";
import { ProductFrame } from "@/features/marketing/previews/preview-root";
import { PREVIEW_BRANCH, PREVIEW_REPO } from "@/features/marketing/preview-data";
import { isFlowGenerationLive } from "@/features/marketing/readiness";
import { cn } from "@/lib/utils";

export const steps = HOW_IT_WORKS.steps;
type Step = (typeof steps)[number];

/**
 * How it works (design.md item 4, F5). Three variants:
 * - `sticky` (motion allowed, 768 px and up): four text steps in normal flow,
 *   one CSS-sticky visual that crossfades between four states.
 * - `stacked` with motion (under 768 px): each step is a panel that fades
 *   and rises 16 px once as it enters.
 * - `stacked` static (server render, before hydration, reduced motion): four
 *   panels, all visible, no transform.
 */
export function HowItWorks() {
  const reduced = usePrefersReducedMotion();
  const motionAllowed = useMotionAllowed();
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
        {layout === "sticky" ? <StickyStory /> : <StackedStory animate={motionAllowed} />}
      </div>
    </section>
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
          <span className="sr-only">Step {index + 1}: </span>
          {step.title}
        </h3>
        <p className={cn(bodyClass, sticky && "text-foreground")}>{step.body}</p>
      </div>
    </div>
  );
}

const FRAME_PATH: Readonly<Record<StepKey, string>> = {
  connect: `${PREVIEW_REPO} · ${PREVIEW_BRANCH}`,
  scan: `${PREVIEW_REPO} · scan`,
  recommend: `${PREVIEW_REPO} · recommendations`,
  generate: `${PREVIEW_REPO} · flow`,
};

function StepVisual({
  stepKey,
  edges,
  active,
  className,
}: {
  stepKey: StepKey;
  edges: "static" | "draw";
  active: boolean;
  className?: string;
}) {
  return (
    <ProductFrame name={`step-${stepKey}`} path={FRAME_PATH[stepKey]} className={className}>
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

/* ---------- stacked: server render, reduced motion, and phones ---------- */

function StackedStory({ animate }: { animate: boolean }) {
  return (
    <ol className="mt-16 flex flex-col gap-16 md:mt-20 md:gap-24">
      {steps.map((step, index) =>
        animate ? (
          <AnimatedPanel key={step.key} step={step} index={index} />
        ) : (
          <li key={step.key} data-story-step={step.key} className="list-none">
            <PanelBody step={step} index={index} edges="static" active />
          </li>
        ),
      )}
    </ol>
  );
}

function PanelBody({
  step,
  index,
  edges,
  active,
}: {
  step: Step;
  index: number;
  edges: "static" | "draw";
  active: boolean;
}) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-16">
      <StepText step={step} index={index} />
      <StepVisual stepKey={step.key} edges={edges} active={active} />
    </div>
  );
}

function AnimatedPanel({ step, index }: { step: Step; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  return (
    <motion.li
      ref={ref}
      data-story-step={step.key}
      className="list-none"
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <PanelBody step={step} index={index} edges="draw" active={inView} />
    </motion.li>
  );
}

/* ---------- sticky: desktop with motion ---------- */

function StickyStory() {
  const [active, setActive] = useState(0);
  return (
    <div className="mt-8 grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-16">
      <ol className="flex flex-col">
        {steps.map((step, index) => (
          <StickyStepText key={step.key} step={step} index={index} active={active === index} onActive={setActive} />
        ))}
      </ol>
      <div>
        <div
          data-story-visual="sticky"
          className="sticky top-24 will-change-transform"
          style={{ perspective: "1200px" }}
        >
          <div className="relative h-[540px]">
            {steps.map((step, index) => {
              const isActive = active === index;
              return (
                <motion.div
                  key={step.key}
                  data-story-visual-state={step.key}
                  className="absolute inset-x-0 top-0"
                  initial={false}
                  animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : 12, rotateX: isActive ? 0 : 6 }}
                  transition={{ duration: 0.5, ease: EASE_OUT }}
                  style={{ transformOrigin: "50% 100%" }}
                >
                  <StepVisual stepKey={step.key} edges="draw" active={isActive} />
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StickyStepText({
  step,
  index,
  active,
  onActive,
}: {
  step: Step;
  index: number;
  active: boolean;
  onActive: (index: number) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Active when the step's text crosses the middle of the viewport.
  const crossing = useInView(ref, { margin: "-50% 0px -50% 0px" });
  useEffect(() => {
    if (crossing) onActive(index);
  }, [crossing, index, onActive]);

  return (
    <li
      ref={ref}
      data-story-step={step.key}
      data-active={active ? "true" : "false"}
      className="relative flex min-h-[70vh] list-none items-center pl-8"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-grid" />
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-px bg-primary transition-opacity duration-500",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <StepText step={step} index={index} active={active} />
    </li>
  );
}
