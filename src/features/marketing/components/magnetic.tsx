"use client";

import { motion, useInView, useMotionValue, useScroll, useSpring } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { FINE_POINTER_QUERY, useMediaQuery, useMotionAllowed } from "@/features/marketing/hooks";
import { cn } from "@/lib/utils";

/**
 * Magnetic primary button (design.md "Landing motion identity" item 8,
 * contract M9). Wraps the hero and Final CTA "Get started" links. While the
 * pointer is within the button's box grown by 24 px, the wrapper moves toward
 * it by 0.25 × the offset, capped at 6 px per axis, smoothed by a spring.
 * Needs motion and a fine hovering pointer; keyboard focus never moves it.
 * The box is read once and cached until the next scroll or resize.
 */

const ZONE = 24;
const PULL = 0.25;
const CAP = 6;
const clamp = (v: number) => Math.max(-CAP, Math.min(CAP, v));

export function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const motionAllowed = useMotionAllowed();
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const enabled = motionAllowed && finePointer;
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const spring = { stiffness: 300, damping: 30, mass: 0.5 };
  const x = useSpring(rawX, spring);
  const y = useSpring(rawY, spring);
  const { scrollY } = useScroll();

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !inView || el === null) return;
    // Untransformed box: the current pull is subtracted from the read rect.
    let box: { left: number; top: number; width: number; height: number } | null = null;
    const invalidate = () => {
      box = null;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      if (box === null) {
        const rect = el.getBoundingClientRect();
        box = { left: rect.left - x.get(), top: rect.top - y.get(), width: rect.width, height: rect.height };
      }
      const inside =
        event.clientX >= box.left - ZONE &&
        event.clientX <= box.left + box.width + ZONE &&
        event.clientY >= box.top - ZONE &&
        event.clientY <= box.top + box.height + ZONE;
      if (!inside) {
        rawX.set(0);
        rawY.set(0);
        return;
      }
      rawX.set(clamp((event.clientX - (box.left + box.width / 2)) * PULL));
      rawY.set(clamp((event.clientY - (box.top + box.height / 2)) * PULL));
    };
    const onLeaveWindow = () => {
      rawX.set(0);
      rawY.set(0);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeaveWindow, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    const offScroll = scrollY.on("change", invalidate);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeaveWindow);
      window.removeEventListener("resize", invalidate);
      offScroll();
      rawX.set(0);
      rawY.set(0);
    };
  }, [enabled, inView, rawX, rawY, x, y, scrollY]);

  return (
    <motion.span
      ref={ref}
      data-magnetic={enabled ? "on" : "off"}
      className={cn("inline-flex", className)}
      style={enabled ? { x, y } : undefined}
    >
      {children}
    </motion.span>
  );
}
