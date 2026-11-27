"use client";

import { useSyncExternalStore } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true once running on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/** Live `matchMedia` result; `false` on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!hasMatchMedia()) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => (hasMatchMedia() ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export const DESKTOP_QUERY = "(min-width: 768px)";
/** Fine hovering pointer (same query as Lenis, D-56): parallax and the magnetic button need it. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
/** 1280 px and up: the hero node chips need the side space beside the headline. */
export const WIDE_QUERY = "(min-width: 1280px)";

/**
 * True only on the client when motion is allowed. Server render and
 * hydration always get `false`, so the first paint is fully visible with no
 * transform (design.md "Before hydration").
 */
export function useMotionAllowed(): boolean {
  const mounted = useMounted();
  const reduced = usePrefersReducedMotion();
  return mounted && !reduced;
}

/** Landing easing (design.md): cubic-bezier(0.16, 1, 0.3, 1). */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
