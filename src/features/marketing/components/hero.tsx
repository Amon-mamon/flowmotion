"use client";

import { motion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef, type ReactNode, type RefObject } from "react";

import { HERO } from "@/features/marketing/copy";
import { HeroNodes } from "@/features/marketing/components/hero-nodes";
import { Magnetic } from "@/features/marketing/components/magnetic";
import {
  containerClass,
  primaryButtonClass,
  secondaryButtonClass,
  Tag,
} from "@/features/marketing/components/primitives";
import {
  FINE_POINTER_QUERY,
  useMediaQuery,
  useMotionAllowed,
  useMounted,
  WIDE_QUERY,
} from "@/features/marketing/hooks";
import { AnalysisPreview } from "@/features/marketing/previews/parts";
import { ProductFrame } from "@/features/marketing/previews/preview-root";

/**
 * Hero (design.md item 2): centred copy on the background grid, then the
 * analysis preview in a product frame on the one accent glow. The frame
 * carries the flow line's output handle (`data-flow-handle`). From 1280 px
 * the node chips assemble above the frame as scrolling starts (M6).
 */
export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const mounted = useMounted();
  const motionAllowed = useMotionAllowed();
  const wide = useMediaQuery(WIDE_QUERY);
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);

  const frame = (
    <ProductFrame name="hero-analysis" path={HERO.framePath} bodyClassName="p-4 sm:p-6">
      <AnalysisPreview />
    </ProductFrame>
  );

  return (
    <section
      ref={sectionRef}
      data-flow-hero=""
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="fm-grid-bg absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
      />
      {mounted && wide ? (
        <HeroNodes heroRef={sectionRef} motionAllowed={motionAllowed} parallax={motionAllowed && finePointer} />
      ) : null}
      <div className={`${containerClass} flex flex-col items-center pt-20 text-center md:pt-32`}>
        <Tag>{HERO.tag}</Tag>
        <h1
          id="hero-heading"
          tabIndex={-1}
          className="mt-6 max-w-[920px] text-[44px] leading-[48px] font-semibold tracking-[-0.04em] text-balance text-foreground outline-none md:text-[72px] md:leading-[76px]"
        >
          {HERO.heading}
        </h1>
        <p className="mt-6 max-w-[640px] text-lg leading-7 text-pretty text-muted-foreground md:text-xl md:leading-[30px]">
          {HERO.lead}
        </p>
        <div className="mt-10 flex flex-col items-stretch gap-3 self-stretch sm:flex-row sm:items-center sm:justify-center sm:self-auto">
          <Magnetic className="flex flex-col sm:inline-flex">
            <Link href={HERO.primary.href} className={primaryButtonClass}>
              {HERO.primary.label}
            </Link>
          </Magnetic>
          <a href={HERO.secondary.href} className={secondaryButtonClass}>
            {HERO.secondary.label}
          </a>
        </div>
      </div>

      <div className={`${containerClass} relative pt-16 pb-20 md:pt-24 md:pb-32`}>
        <div
          aria-hidden="true"
          className="fm-hero-glow absolute inset-x-0 top-0 -z-10 mx-auto h-full max-w-[1100px]"
        />
        <div data-flow-handle="" className="relative mx-auto max-w-[1040px]" style={{ perspective: "1200px" }}>
          {motionAllowed ? <TiltingFrame target={sectionRef}>{frame}</TiltingFrame> : frame}
          {mounted ? <OutputHandle /> : null}
        </div>
      </div>
    </section>
  );
}

/** The flow line's output handle: 8 px circle on the frame's bottom edge, centred. */
function OutputHandle() {
  return (
    <span
      aria-hidden="true"
      data-flow-output=""
      className="pointer-events-none absolute bottom-0 left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full border-[1.5px] border-primary bg-background"
    />
  );
}

/**
 * Scroll-driven 3D tilt (RM-3). Flat at load and at scroll 0, so nothing
 * moves without the reader; as the hero scrolls past (progress 0.35 → 1) the
 * frame leans back under `perspective: 1200px` (rotateX 0 → 10°, scale
 * 1 → 0.96, pivoting on its bottom edge). Fully reversible; only rendered
 * with motion allowed, so reduced motion keeps it flat.
 */
function TiltingFrame({ target, children }: { target: RefObject<HTMLElement | null>; children: ReactNode }) {
  const { scrollYProgress } = useScroll({ target, offset: ["start start", "end start"] });
  const rotateX = useTransform(scrollYProgress, [0.35, 1], [0, 10], { clamp: true });
  const scale = useTransform(scrollYProgress, [0.35, 1], [1, 0.96], { clamp: true });
  return (
    <motion.div data-hero-frame="tilt" style={{ rotateX, scale, transformOrigin: "50% 100%" }}>
      {children}
    </motion.div>
  );
}
