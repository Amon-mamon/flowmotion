import Link from "next/link";

import { HEADER } from "@/features/marketing/copy";
import { MarketingWordmark } from "@/features/marketing/components/marketing-wordmark";
import { primaryButtonClass } from "@/features/marketing/components/primitives";
import { cn } from "@/lib/utils";

const navLinkClass =
  "rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Sticky marketing header (design.md "Landing page" item 1). On `/` the nav
 * links are same-page anchors; on `/privacy` and `/terms` they point back to
 * `/#…` (`anchorBase="/"`). `drawWordmark` (set only by the landing page)
 * lets the wordmark's joining line draw once on load.
 */
export function SiteHeader({
  anchorBase = "",
  drawWordmark = false,
}: {
  anchorBase?: "" | "/";
  drawWordmark?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-4 px-4 max-[359px]:gap-2 sm:gap-6 sm:px-8">
        <MarketingWordmark draw={drawWordmark} />
        <nav aria-label={HEADER.navLabel} className="hidden items-center md:flex">
          {HEADER.nav.map((item) => (
            <a key={item.anchor} href={`${anchorBase}#${item.anchor}`} className={navLinkClass}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 max-[359px]:gap-0.5 sm:gap-2">
          <Link href={HEADER.login.href} className={cn(navLinkClass, "max-[359px]:px-2")}>
            {HEADER.login.label}
          </Link>
          <Link href={HEADER.getStarted.href} className={cn(primaryButtonClass, "px-4 whitespace-nowrap max-[359px]:px-3 sm:px-5")}>
            {HEADER.getStarted.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
