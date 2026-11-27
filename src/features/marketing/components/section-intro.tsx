"use client";

import { motion } from "motion/react";
import { useRef } from "react";

import { h2Class, leadClass } from "@/features/marketing/components/primitives";
import { settleTarget, useIntroPhase, WordReveal } from "@/features/marketing/components/word-reveal";
import { useMotionAllowed } from "@/features/marketing/hooks";
import { cn } from "@/lib/utils";

/**
 * Section intro: eyebrow (the flow node's anchor), H2 (focus target for
 * anchors), lead. With motion on, an intro that is below the fold when motion
 * starts settles in once when its section's flow node lights: the H2 word by
 * word, the eyebrow with the first word, the lead 120 ms later.
 */
export function SectionIntro({
  id,
  eyebrow,
  heading,
  lead,
  className,
}: {
  id: string;
  eyebrow?: string;
  heading: string;
  lead?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motionAllowed = useMotionAllowed();
  const phase = useIntroPhase(id, ref);
  return (
    <div ref={ref} className={cn("flex max-w-[640px] flex-col gap-4", className)}>
      {eyebrow ? (
        <motion.p
          data-flow-anchor=""
          className="fm-mono-label text-primary"
          animate={motionAllowed ? settleTarget(phase, 0, 0) : undefined}
        >
          {eyebrow}
        </motion.p>
      ) : null}
      <h2 id={`${id}-heading`} tabIndex={-1} className={h2Class}>
        <WordReveal text={heading} phase={phase} />
      </h2>
      {lead ? (
        <motion.p className={leadClass} animate={motionAllowed ? settleTarget(phase, 0.12, 12) : undefined}>
          {lead}
        </motion.p>
      ) : null}
    </div>
  );
}
