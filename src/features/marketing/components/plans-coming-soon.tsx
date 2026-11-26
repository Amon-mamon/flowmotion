import { containerClass, h2Class, sectionClass } from "@/features/marketing/components/primitives";

/**
 * Exact copy from docs/design.md. Do not change without the architect.
 * No prices, no checkout, no button, no link, no tag (docs/subscription.md is NOT READY).
 */
export const PLANS_HEADING = "Plans coming soon";
export const PLANS_BODY =
  "Flow Motion is in early testing. There are no paid plans, prices, or credits yet. Pricing will be announced here before anything changes.";

export function PlansComingSoon() {
  return (
    <section id="plans" aria-labelledby="plans-heading" className={sectionClass}>
      <div className={containerClass}>
        <div className="flex max-w-[640px] flex-col gap-4">
          <h2 id="plans-heading" tabIndex={-1} className={h2Class}>
            {PLANS_HEADING}
          </h2>
          <p className="text-lg leading-7 text-muted-foreground md:text-xl md:leading-[30px]">{PLANS_BODY}</p>
        </div>
      </div>
    </section>
  );
}
