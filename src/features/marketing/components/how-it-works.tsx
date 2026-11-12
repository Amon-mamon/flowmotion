"use client";

import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef, useSyncExternalStore } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true once running on the client. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export const steps = [
  {
    number: "01",
    title: "Connect a repository",
    body: "Install the read-only GitHub App and pick a repository. Flow Motion first checks that it is a real website or app project. If it is not, it stops and tells you why, with no AI spend.",
  },
  {
    number: "02",
    title: "Review what we found",
    body: "Only safe files are read. Secrets are masked before anything leaves the pipeline. You get a list of security findings and automation recommendations with their source files.",
  },
  {
    number: "03",
    title: "Generate, simulate, export",
    body: "Pick recommendations. Each becomes a flow built only from allowed n8n nodes, shown as a node graph you can inspect, run against mock data, and export as n8n JSON with a setup checklist.",
  },
] as const;

export function HowItWorks() {
  const reduced = usePrefersReducedMotion();

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      data-motion={reduced ? "reduced" : "full"}
      className="border-t border-border py-20 sm:py-28"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 sm:px-8">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-sm font-medium uppercase tracking-wide text-primary">How it works</p>
          <h2 id="how-it-works-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Three steps, nothing hidden
          </h2>
          <p className="text-base text-muted-foreground sm:text-lg">
            Every step shows you what was read, what was skipped, and what was produced.
          </p>
        </div>
        <ol
          className="flex flex-col gap-8"
          style={{ perspective: "1200px", transformStyle: "preserve-3d" }}
        >
          {steps.map((step, index) => (
            <StoryCard key={step.number} step={step} index={index} reduced={reduced} />
          ))}
        </ol>
      </div>
    </section>
  );
}

type Step = (typeof steps)[number];

function StoryCard({ step, index, reduced }: { step: Step; index: number; reduced: boolean }) {
  const mounted = useMounted();

  // Server render and pre-hydration: a plain, fully visible card. Animation
  // only starts once JavaScript is running, so content never hides behind it.
  if (!mounted) {
    return (
      <li className="list-none" data-story-card="static">
        <StoryCardBody step={step} index={index} />
      </li>
    );
  }

  if (reduced) {
    return (
      <motion.li
        initial={{ opacity: 0.4 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.4 }}
        className="list-none"
        data-story-card="fade"
      >
        <StoryCardBody step={step} index={index} />
      </motion.li>
    );
  }

  return <ScrollStoryCard step={step} index={index} />;
}

function ScrollStoryCard({ step, index }: { step: Step; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 95%", "center 55%"],
  });
  return <AnimatedStoryCard ref={ref} progress={scrollYProgress} step={step} index={index} />;
}

function AnimatedStoryCard({
  ref,
  progress,
  step,
  index,
}: {
  ref: React.RefObject<HTMLLIElement | null>;
  progress: MotionValue<number>;
  step: Step;
  index: number;
}) {
  // Each card tilts up from "below the floor", moves forward in depth, and
  // settles flat as it reaches the middle of the viewport.
  const rotateX = useTransform(progress, [0, 1], [28, 0]);
  const z = useTransform(progress, [0, 1], [-220, 0]);
  const y = useTransform(progress, [0, 1], [48, 0]);
  const opacity = useTransform(progress, [0, 0.6, 1], [0.25, 0.9, 1]);
  const scale = useTransform(progress, [0, 1], [0.94, 1]);

  return (
    <motion.li
      ref={ref}
      style={{ rotateX, z, y, opacity, scale, transformOrigin: "50% 100%" }}
      className="list-none will-change-transform"
      data-story-card="scroll"
    >
      <StoryCardBody step={step} index={index} />
    </motion.li>
  );
}

function StoryCardBody({ step, index }: { step: Step; index: number }) {
  return (
    <article className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-10">
      <span className="font-mono text-4xl font-semibold text-primary sm:text-5xl" aria-hidden="true">
        {step.number}
      </span>
      <div className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
          <span className="sr-only">Step {index + 1}: </span>
          {step.title}
        </h3>
        <p className="max-w-2xl text-base text-muted-foreground">{step.body}</p>
      </div>
    </article>
  );
}
