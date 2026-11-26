"use client";

import { animate, motion, useMotionValue, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import { HERO } from "@/features/marketing/copy";
import {
  containerClass,
  primaryButtonClass,
  secondaryButtonClass,
  Tag,
} from "@/features/marketing/components/primitives";
import { EASE_OUT, useMotionAllowed } from "@/features/marketing/hooks";
import { AnalysisPreview } from "@/features/marketing/previews/parts";
import { ProductFrame } from "@/features/marketing/previews/preview-root";

/**
 * Hero (design.md item 2): centred copy on the background grid, then the
 * analysis preview in a product frame on the one accent glow. With motion
 * allowed the frame starts tilted back (rotateX 14°, scale 0.94) and flattens
 * over the first 60% of the hero's scroll range; the server render is flat.
 */
export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const motionAllowed = useMotionAllowed();

  const frame = (
    <ProductFrame name="hero-analysis" path={HERO.framePath} bodyClassName="p-4 sm:p-6">
      <AnalysisPreview />
    </ProductFrame>
  );

  return (
    <section ref={sectionRef} aria-labelledby="hero-heading" className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="fm-grid-bg absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
      />
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
          <Link href={HERO.primary.href} className={primaryButtonClass}>
            {HERO.primary.label}
          </Link>
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
        <div className="mx-auto max-w-[1040px]" style={{ perspective: "1200px" }}>
          {motionAllowed ? <TiltingFrame target={sectionRef}>{frame}</TiltingFrame> : frame}
        </div>
      </div>
    </section>
  );
}

function TiltingFrame({
  target,
  children,
}: {
  target: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { scrollYProgress } = useScroll({ target, offset: ["start start", "end start"] });
  // A short settle on mount so the switch from the flat server render to the
  // tilted start position is eased, not a jump.
  const intro = useMotionValue(0);
  useEffect(() => {
    const controls = animate(intro, 1, { duration: 0.6, ease: EASE_OUT });
    return () => controls.stop();
  }, [intro]);

  const flatten = useTransform(scrollYProgress, [0, 0.6], [1, 0], { clamp: true });
  const rotateX = useTransform(() => 14 * intro.get() * flatten.get());
  const scale = useTransform(() => 1 - 0.06 * intro.get() * flatten.get());

  return (
    <motion.div
      data-hero-frame="tilt"
      style={{ rotateX, scale, transformOrigin: "50% 0%" }}
      className="will-change-transform"
    >
      {children}
    </motion.div>
  );
}
