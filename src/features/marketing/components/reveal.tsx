"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

import { EASE_OUT, useMotionAllowed } from "@/features/marketing/hooks";

/**
 * Features card entrance (design.md Motion): rises 24 px and loses a 6°
 * rotateX tilt once as it enters. Server render, hydration, and reduced
 * motion get a plain element with no transform.
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
  if (!motionAllowed) {
    return (
      <div className={className} data-reveal="static">
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      data-reveal="motion"
      style={{ transformPerspective: 1200, transformOrigin: "50% 100%" }}
      initial={{ opacity: 0, y: 24, rotateX: 6 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
