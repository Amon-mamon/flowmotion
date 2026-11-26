import Link from "next/link";

import { FINAL_CTA } from "@/features/marketing/copy";
import {
  containerClass,
  h2Class,
  primaryButtonClass,
  QuietLink,
} from "@/features/marketing/components/primitives";
import { cn } from "@/lib/utils";

/** Final call to action (design.md item 9): a bordered band on surface, left-aligned. */
export function FinalCta() {
  return (
    <section id="get-started" aria-labelledby="get-started-heading" className="scroll-mt-20 pb-20 md:pb-32">
      <div className={containerClass}>
        <div className="flex flex-col gap-10 rounded-xl border border-border bg-card p-8 md:p-12 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-[640px] flex-col gap-4">
            <h2 id="get-started-heading" tabIndex={-1} className={cn(h2Class, "text-balance")}>
              {FINAL_CTA.heading}
            </h2>
            <p className="text-lg leading-7 text-muted-foreground">{FINAL_CTA.body}</p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <Link href={FINAL_CTA.primary.href} className={primaryButtonClass}>
              {FINAL_CTA.primary.label}
            </Link>
            <QuietLink href={FINAL_CTA.secondary.href} tone="foreground">
              {FINAL_CTA.secondary.label}
            </QuietLink>
          </div>
        </div>
      </div>
    </section>
  );
}
