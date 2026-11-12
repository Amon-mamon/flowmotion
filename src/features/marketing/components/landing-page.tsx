import { Faq } from "@/features/marketing/components/faq";
import { Features } from "@/features/marketing/components/features";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { PlansComingSoon } from "@/features/marketing/components/plans-coming-soon";
import { Security } from "@/features/marketing/components/security";

/** Landing page sections in the order given by docs/design.md. */
export function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <Security />
      <PlansComingSoon />
      <Faq />
    </>
  );
}
