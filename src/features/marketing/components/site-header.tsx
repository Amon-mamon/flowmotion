import Link from "next/link";

import { Wordmark } from "@/components/shared/wordmark";
import { HEADER } from "@/features/marketing/copy";
import { primaryButtonSmClass } from "@/features/marketing/components/primitives";

const navLinkClass =
  "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Sticky marketing header (design.md "Landing page" item 1). On `/` the nav
 * links are same-page anchors; on `/privacy` and `/terms` they point back to
 * `/#…` (`anchorBase="/"`).
 */
export function SiteHeader({ anchorBase = "" }: { anchorBase?: "" | "/" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-6 px-4 sm:px-8">
        <Wordmark />
        <nav aria-label={HEADER.navLabel} className="hidden items-center md:flex">
          {HEADER.nav.map((item) => (
            <a key={item.anchor} href={`${anchorBase}#${item.anchor}`} className={navLinkClass}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link href={HEADER.login.href} className={navLinkClass}>
            {HEADER.login.label}
          </Link>
          <Link href={HEADER.getStarted.href} className={primaryButtonSmClass}>
            {HEADER.getStarted.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
