"use client";

import { motion, useTransform, type MotionValue } from "motion/react";
import type { ReactNode } from "react";

/**
 * Scroll-progress helpers for the desktop story visual (design.md "Landing
 * motion identity" item 7). Opacity and transform only; every value comes
 * from `useTransform` on the story progress, so scrolling up reverses it.
 */

/** Fades its child in over a 0.02-wide progress window centred on `at`. */
export function ProgressFade({
  progress,
  at,
  className,
  children,
}: {
  progress: MotionValue<number>;
  at: number;
  className?: string;
  children: ReactNode;
}) {
  const opacity = useTransform(progress, [at - 0.01, at + 0.01], [0, 1], { clamp: true });
  return (
    <motion.span className={className} style={{ opacity }}>
      {children}
    </motion.span>
  );
}

/** Same as ProgressFade for block content. */
export function ProgressFadeBlock({
  progress,
  at,
  children,
}: {
  progress: MotionValue<number>;
  at: number;
  children: ReactNode;
}) {
  const opacity = useTransform(progress, [at - 0.01, at + 0.01], [0, 1], { clamp: true });
  return <motion.div style={{ opacity }}>{children}</motion.div>;
}

/**
 * The 1 px accent scanner bar (opacity 0.8, full width) that moves from the
 * top of the file tree to its bottom over p 0.25 → 0.40. The overlay is the
 * tree's height, so translating it by 0 → 100% moves the bar top to bottom.
 */
export function ScannerBar({ progress }: { progress: MotionValue<number> }) {
  const y = useTransform(progress, [0.25, 0.4], ["0%", "100%"], { clamp: true });
  const opacity = useTransform(progress, [0.24, 0.25, 0.4, 0.41], [0, 0.8, 0.8, 0], { clamp: true });
  return (
    <motion.div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-full" style={{ y, opacity }}>
      <div className="h-px w-full bg-primary" />
    </motion.div>
  );
}
