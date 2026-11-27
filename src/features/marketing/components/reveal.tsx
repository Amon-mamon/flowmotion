"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

import { useEntrance } from "@/features/marketing/entrance";
import { useMotionAllowed } from "@/features/marketing/hooks";

/**
 * Features card entrance (design.md Motion): rises 24 px and loses a 6°
 * rotateX tilt once as it enters. Server render, hydration, and reduced
 * motion get no inline style; cards already on screen when motion starts
 * stay as they are (RL-2).
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const motionAllowed = useMotionAllowed();
  const { ref, style } = useEntrance<HTMLDivElement>(motionAllowed, { y: 24, rotateX: 6 }, {
    delay,
    duration: 0.6,
    amount: 0.1,
  });
  return (
    <motion.div ref={ref} className={className} data-reveal={motionAllowed ? "motion" : "static"} style={style}>
      {children}
    </motion.div>
  );
}
