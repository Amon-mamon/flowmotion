import { CheckIcon } from "lucide-react";

import { SECURITY } from "@/features/marketing/copy";
import {
  containerClass,
  QuietLink,
  sectionClass,
} from "@/features/marketing/components/primitives";
import { SectionIntro } from "@/features/marketing/components/section-intro";
import { FindingRowPreview } from "@/features/marketing/previews/parts";
import { ProductFrame } from "@/features/marketing/previews/preview-root";
import { cn } from "@/lib/utils";

/** Security (design.md item 6): five guarantees left, an example finding right, on the background grid. */
export function Security() {
  return (
    <section id="security" aria-labelledby="security-heading" className={cn(sectionClass, "relative isolate overflow-clip")}>
      <div
        aria-hidden="true"
        className="fm-grid-bg absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_70%_50%,black_30%,transparent_75%)]"
      />
      <div className={cn(containerClass, "grid gap-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-start lg:gap-20")}>
        <div className="flex flex-col gap-12">
          <SectionIntro id="security" eyebrow={SECURITY.eyebrow} heading={SECURITY.heading} lead={SECURITY.lead} />
          <ul className="flex flex-col">
            {SECURITY.guarantees.map((item) => (
              <li key={item.title} className="flex gap-4 border-t border-grid py-5 first:border-t-0 first:pt-0">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                  <CheckIcon aria-hidden="true" strokeWidth={1.5} className="size-3.5 text-primary" />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base leading-6 font-semibold text-foreground">{item.title}</h3>
                  <p className="max-w-[65ch] text-base leading-[26px] text-muted-foreground">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <QuietLink href={SECURITY.privacyLink.href} tone="foreground" className="self-start">
            {SECURITY.privacyLink.label}
          </QuietLink>
        </div>
        <div className="lg:sticky lg:top-24">
          <ProductFrame name="security-finding" path={SECURITY.framePath}>
            <FindingRowPreview example />
          </ProductFrame>
        </div>
      </div>
    </section>
  );
}
