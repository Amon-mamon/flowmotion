import { Section } from "@/features/marketing/components/section";

/**
 * Exact copy from docs/design.md. Do not change without the architect.
 * No prices, no checkout, no button (docs/subscription.md is NOT READY).
 */
export const PLANS_HEADING = "Plans coming soon";
export const PLANS_BODY =
  "Flow Motion is in early testing. There are no paid plans, prices, or credits yet. Pricing will be announced here before anything changes.";

export function PlansComingSoon() {
  return <Section id="plans" title={PLANS_HEADING} description={PLANS_BODY} />;
}
