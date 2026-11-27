"use client";

import { motion } from "motion/react";
import Link from "next/link";

import { BRAND } from "@/features/marketing/copy";
import { EASE_OUT, useMotionAllowed } from "@/features/marketing/hooks";

/**
 * Marketing wordmark (design.md "Landing motion identity" item 6, contract
 * M7): the square mark, "Flow", a short accent joining line, "Motion". The
 * line draws once on load only when `draw` is set (the header on `/`) and
 * motion is allowed; in the footer, on the legal pages, before mount, and
 * under reduced motion it is static and fully drawn. The app shell and auth
 * pages keep the shared Wordmark.
 */
export function MarketingWordmark({ draw = false }: { draw?: boolean }) {
  const motionAllowed = useMotionAllowed();
  const animateLine = draw && motionAllowed;
  return (
    <Link
      href="/"
      aria-label={BRAND.name}
      className="inline-flex items-center gap-2 rounded-lg font-semibold tracking-tight text-foreground"
    >
      <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-primary" />
      <span className="inline-flex items-center">
        {BRAND.first}
        <svg
          aria-hidden="true"
          focusable="false"
          data-wordmark-line={animateLine ? "draw" : "static"}
          width={16}
          height={8}
          viewBox="0 0 16 8"
          fill="none"
          className="pointer-events-none mx-1 shrink-0"
        >
          {animateLine ? (
            <motion.path
              d="M 1 4 L 15 4"
              stroke="var(--fm-accent)"
              strokeWidth={1.5}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT }}
            />
          ) : (
            <path d="M 1 4 L 15 4" stroke="var(--fm-accent)" strokeWidth={1.5} strokeLinecap="round" />
          )}
        </svg>{" "}
        {BRAND.second}
      </span>
    </Link>
  );
}
