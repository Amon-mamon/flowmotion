import Link from "next/link";

import { MarketingWordmark } from "@/features/marketing/components/marketing-wordmark";
import { FOOTER } from "@/features/marketing/copy";

/** Marketing footer (design.md "Landing page" item 10). */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <MarketingWordmark />
          <p className="text-sm text-muted-foreground">{FOOTER.tagline}</p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <nav aria-label={FOOTER.navLabel} className="flex items-center gap-6 text-sm">
            {FOOTER.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="text-sm text-muted-foreground">{FOOTER.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
