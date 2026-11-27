"use client";

import { inView, motion, type TargetAndTransition } from "motion/react";
import { Fragment, useEffect, useRef, useState, type RefObject } from "react";

import { useFlowStore } from "@/features/marketing/flow-store";
import { EASE_OUT, useMotionAllowed } from "@/features/marketing/hooks";

/**
 * Section intro settle and headline word reveal (design.md "Landing motion
 * identity" item 4, contract M5).
 *
 * Phases: `plain` (server render, hydration, reduced motion, or an intro that
 * was already on screen when motion started: final state, plain text),
 * `hidden` (below the fold when motion started, waiting for its node), and
 * `reveal` (its node lit: words rise in, once).
 */
export type IntroPhase = "plain" | "hidden" | "reveal";

const WORD_STAGGER = 0.04;
const MAX_STAGGERED_WORDS = 8;
const SETTLE = { duration: 0.5, ease: EASE_OUT } as const;

export function useIntroPhase(sectionId: string, ref: RefObject<HTMLElement | null>): IntroPhase {
  const motionAllowed = useMotionAllowed();
  const store = useFlowStore();
  const [state, setState] = useState<"plain" | "hidden" | "reveal">("plain");

  useEffect(() => {
    if (!motionAllowed) return;
    const cleanups: (() => void)[] = [];
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      setState("reveal");
      for (const cleanup of cleanups.splice(0)) cleanup();
    };
    // Decide on the next frame. Only intros below the fold are hidden, so the
    // one-frame delay is never visible.
    const frame = window.requestAnimationFrame(() => {
      const el = ref.current;
      if (el === null || el.getBoundingClientRect().top < window.innerHeight) return;
      setState("hidden");
      // Trigger: the section's flow node lights. Fallback with the same
      // geometry (the intro crossing the tip line at 60% of the viewport), so
      // an intro can never stay hidden if the flow layer cannot measure.
      cleanups.push(inView(el, reveal, { margin: "0px 0px -40% 0px" }));
      if (store !== null) {
        const check = () => {
          if (store.isLit(sectionId)) reveal();
        };
        cleanups.push(store.subscribe(check));
        check();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      for (const cleanup of cleanups.splice(0)) cleanup();
      setState("plain");
    };
  }, [motionAllowed, store, sectionId, ref]);

  return motionAllowed ? state : "plain";
}

/** Settle target for the eyebrow (with the first word) and lead (120 ms later). */
export function settleTarget(phase: IntroPhase, delay: number, rise: number): TargetAndTransition {
  if (phase === "hidden") return { opacity: 0, y: rise, transition: { duration: 0 } };
  return { opacity: 1, y: 0, transition: phase === "reveal" ? { ...SETTLE, delay } : { duration: 0 } };
}

/**
 * Heading text as plain inline-block word spans with ordinary spaces between
 * them, inside the caller's heading element: no ARIA attributes, so the
 * accessible name and textContent equal the copy. Plain text when `plain`.
 */
export function WordReveal({ text, phase }: { text: string; phase: IntroPhase }) {
  if (phase === "plain") return <>{text}</>;
  const words = text.split(" ");
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={index}>
          <motion.span
            data-word=""
            className="inline-block"
            initial={{ opacity: 0, y: 12 }}
            animate={phase === "reveal" ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
            transition={{ ...SETTLE, delay: Math.min(index, MAX_STAGGERED_WORDS - 1) * WORD_STAGGER }}
          >
            {word}
          </motion.span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

/** An H2 that reveals word by word when its section's node lights (Final CTA). */
export function RevealHeading({
  sectionId,
  id,
  text,
  className,
}: {
  sectionId: string;
  id: string;
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const phase = useIntroPhase(sectionId, ref);
  return (
    <h2 ref={ref} id={id} tabIndex={-1} className={className}>
      <WordReveal text={text} phase={phase} />
    </h2>
  );
}
