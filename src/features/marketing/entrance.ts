"use client";

import { animate, inView, useMotionValue, type MotionStyle } from "motion/react";
import { useEffect, useRef } from "react";

import { EASE_OUT } from "@/features/marketing/hooks";

/**
 * Once-only entrance for cards and story panels (design.md "Motion"), with
 * the review rule RL-2: an element that is already on screen when motion
 * starts keeps its server-rendered state and never blinks. Only elements
 * below the fold at that moment are set to their start state (invisible to
 * the reader, since they are off screen) and animate in when they enter.
 *
 * The returned `style` is `undefined` until motion is allowed, so the server
 * render and hydration carry no inline opacity or transform.
 */
export function useEntrance<T extends HTMLElement>(
  enabled: boolean,
  from: { y: number; rotateX?: number },
  options: { delay?: number; duration?: number; amount?: number } = {},
): { ref: React.RefObject<T | null>; style: MotionStyle | undefined } {
  const ref = useRef<T | null>(null);
  const opacity = useMotionValue(1);
  const y = useMotionValue(0);
  const rotateX = useMotionValue(0);
  const fromY = from.y;
  const fromRotate = from.rotateX ?? 0;
  const { delay = 0, duration = 0.5, amount = 0.25 } = options;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || el === null) {
      opacity.set(1);
      y.set(0);
      rotateX.set(0);
      return;
    }
    // One read when motion starts: on screen already → stay as rendered.
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    opacity.set(0);
    y.set(fromY);
    rotateX.set(fromRotate);
    const transition = { duration, delay, ease: EASE_OUT };
    const stop = inView(
      el,
      () => {
        animate(opacity, 1, transition);
        animate(y, 0, transition);
        animate(rotateX, 0, transition);
      },
      { amount },
    );
    return () => stop();
  }, [enabled, opacity, y, rotateX, fromY, fromRotate, delay, duration, amount]);

  const style: MotionStyle | undefined = enabled
    ? fromRotate !== 0
      ? { opacity, y, rotateX, transformPerspective: 1200, transformOrigin: "50% 100%" }
      : { opacity, y }
    : undefined;
  return { ref, style };
}
