import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { COMING_SOON } from "@/features/marketing/copy";
import { cn } from "@/lib/utils";

/** Landing primitives from design.md "Components (landing)". */

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Primary button: accent fill, black text, 8 px radius, 44 px tall. */
export const primaryButtonClass = cn(
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary-strong",
  focusRing,
);

/** Secondary button: transparent, 1 px border-hover border, white text. */
export const secondaryButtonClass = cn(
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border-hover bg-transparent px-5 text-[15px] font-medium text-foreground transition-colors hover:bg-surface-2",
  focusRing,
);

/** Small header variants (same styles, 36 px tall). */
export const primaryButtonSmClass = cn(primaryButtonClass, "h-9 px-3.5 text-sm");

/** Quiet link: text plus a small arrow that moves 2 px right on hover (transform only). */
export function QuietLink({
  href,
  children,
  tone = "muted",
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: "muted" | "foreground";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group/quiet inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors hover:text-foreground",
        tone === "muted" ? "text-muted-foreground" : "text-foreground",
        focusRing,
        className,
      )}
    >
      {children}
      <ArrowRightIcon
        aria-hidden="true"
        strokeWidth={1.5}
        className="size-4 transition-transform duration-200 group-hover/quiet:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover/quiet:translate-x-0"
      />
    </Link>
  );
}

/** Pill tag: 1 px border, mono label text in muted. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "fm-mono-label inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2.5 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * "Coming soon" tag. A single element whose whole text is "Coming soon", so
 * the four places stay countable (F1, F12 d). Callers check
 * isFlowGenerationLive() before rendering it.
 */
export function ComingSoonTag({ className }: { className?: string }) {
  return (
    <span
      data-coming-soon=""
      className={cn(
        "fm-mono-label inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2.5 text-muted-foreground",
        className,
      )}
    >
      {COMING_SOON}
    </span>
  );
}

/** Mono eyebrow above a section heading (on the page background). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="fm-mono-label text-primary">{children}</p>;
}

/** Shared content width and gutters: 1200 px, 16 px on phones, 32 px from 640 px. */
export const containerClass = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";

/** H2 type step: 48/52 → 32/36, 600, tracking -0.03em. */
export const h2Class =
  "text-[32px] leading-9 font-semibold tracking-[-0.03em] text-foreground outline-none md:text-5xl md:leading-[52px]";

/** H3 type step: 24/32 → 20/28, 600. */
export const h3Class = "text-xl leading-7 font-semibold text-foreground md:text-2xl md:leading-8";

/** Lead type step: 20/30 → 18/28. */
export const leadClass = "text-lg leading-7 text-muted-foreground md:text-xl md:leading-[30px]";

/** Body: 16/26, max 65 characters per line. */
export const bodyClass = "max-w-[65ch] text-base leading-[26px] text-muted-foreground";

/** Section padding (128 px desktop, 80 px under 768 px), hairline divider, anchor offset. */
export const sectionClass = "scroll-mt-20 border-t border-grid py-20 md:py-32";

/** Section intro block: eyebrow, H2 (focus target for anchors), lead. */
export function SectionIntro({
  id,
  eyebrow,
  heading,
  lead,
  className,
}: {
  id: string;
  eyebrow?: string;
  heading: string;
  lead?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-[640px] flex-col gap-4", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={`${id}-heading`} tabIndex={-1} className={h2Class}>
        {heading}
      </h2>
      {lead ? <p className={leadClass}>{lead}</p> : null}
    </div>
  );
}
