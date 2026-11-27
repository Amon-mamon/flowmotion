import type { Metadata } from "next";

import { LANDING_META } from "@/features/marketing/copy";
import { LandingPage } from "@/features/marketing/components/landing-page";
import { SiteHeader } from "@/features/marketing/components/site-header";

export const metadata: Metadata = {
  description: LANDING_META.description,
};

export default function Home() {
  return (
    <>
      <SiteHeader drawWordmark />
      <main id="main" className="flex-1">
        <LandingPage />
      </main>
    </>
  );
}
