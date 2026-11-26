import type { ReactNode } from "react";

import { SiteFooter } from "@/features/marketing/components/site-footer";

/**
 * Shared marketing shell. Each page renders its own SiteHeader (same-page
 * anchors on `/`, `/#…` on the legal pages) and `<main>`; this layout never
 * mounts smooth scrolling (D-56).
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
