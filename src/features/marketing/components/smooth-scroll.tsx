"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";

/**
 * Lenis smooth wheel scrolling for the landing page only (D-56, contract
 * section 11, Landing redesign F11). Rendered by LandingPage, never by a
 * layout, so it is destroyed on every navigation away from `/`.
 *
 * - Runs only when reduced motion is off AND the device has a fine, hovering
 *   pointer. Touch-primary devices keep native scrolling.
 * - Smooths the window's own scroll (no wrapper, no snapping, no lock,
 *   wheelMultiplier 1), so Motion `useScroll` keeps reading native scroll.
 * - Adds no keydown, wheel, or touchmove listener and never prevents
 *   keyboard, focus, or find-in-page scrolling. Its only listener is a click
 *   handler for same-page anchors while Lenis runs.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
/** Sticky header (64 px) plus 16 px, same as `scroll-margin-top`. */
export const ANCHOR_OFFSET = -80;

export const LENIS_OPTIONS = {
  autoRaf: true,
  lerp: 0.1,
  smoothWheel: true,
  syncTouch: false,
  wheelMultiplier: 1,
} as const;

/** Section id for a same-page anchor (`#faq`, `/#faq`), or null for anything else. */
function sameDocumentAnchorId(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  if (href === null) return null;
  let hash: string;
  if (href.startsWith("#")) {
    hash = href;
  } else if (href.startsWith("/#") && window.location.pathname === "/") {
    hash = href.slice(1);
  } else {
    return null;
  }
  const id = decodeURIComponent(hash.slice(1));
  return id === "" ? null : id;
}

/** The heading that labels a section (falls back to the section itself). */
function headingFor(section: HTMLElement): HTMLElement {
  const labelledBy = section.getAttribute("aria-labelledby");
  const heading = labelledBy === null ? null : document.getElementById(labelledBy);
  return heading ?? section;
}

export function SmoothScroll() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const finePointer = window.matchMedia(FINE_POINTER_QUERY);
    let lenis: Lenis | null = null;

    const onClick = (event: MouseEvent) => {
      if (lenis === null || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (anchor === null) return;
      const id = sameDocumentAnchorId(anchor);
      if (id === null) return;
      const target = document.getElementById(id);
      if (target === null) return;
      event.preventDefault();
      window.history.pushState(null, "", `#${id}`);
      lenis.scrollTo(target, {
        offset: ANCHOR_OFFSET,
        onComplete: () => {
          const heading = headingFor(target);
          if (heading.tabIndex < 0 && !heading.hasAttribute("tabindex")) {
            heading.setAttribute("tabindex", "-1");
          }
          heading.focus({ preventScroll: true });
        },
      });
    };

    const sync = () => {
      const allowed = !reducedMotion.matches && finePointer.matches;
      if (allowed && lenis === null) {
        lenis = new Lenis({ ...LENIS_OPTIONS });
      } else if (!allowed && lenis !== null) {
        lenis.destroy();
        lenis = null;
      }
    };

    sync();
    reducedMotion.addEventListener("change", sync);
    finePointer.addEventListener("change", sync);
    document.addEventListener("click", onClick);

    return () => {
      reducedMotion.removeEventListener("change", sync);
      finePointer.removeEventListener("change", sync);
      document.removeEventListener("click", onClick);
      lenis?.destroy();
      lenis = null;
    };
  }, []);

  return null;
}
