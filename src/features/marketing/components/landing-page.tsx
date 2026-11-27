import { Faq } from "@/features/marketing/components/faq";
import { FactStrip } from "@/features/marketing/components/fact-strip";
import { Features } from "@/features/marketing/components/features";
import { FinalCta } from "@/features/marketing/components/final-cta";
import { FlowWrapper } from "@/features/marketing/components/flow-wrapper";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { PlansComingSoon } from "@/features/marketing/components/plans-coming-soon";
import { Security } from "@/features/marketing/components/security";
import { SmoothScroll } from "@/features/marketing/components/smooth-scroll";

/**
 * Landing page sections in the order given by docs/design.md "Landing page".
 * SmoothScroll (Lenis, D-56) is mounted here and only here, so it exists on
 * `/` alone and is destroyed on navigation away. Hero to Final CTA sit in the
 * FlowWrapper, which adds the decorative flow layer after mount (D-57).
 */
export function LandingPage() {
  return (
    <>
      <SmoothScroll />
      <FlowWrapper>
        <Hero />
        <FactStrip />
        <HowItWorks />
        <Features />
        <Security />
        <PlansComingSoon />
        <Faq />
        <FinalCta />
      </FlowWrapper>
    </>
  );
}
