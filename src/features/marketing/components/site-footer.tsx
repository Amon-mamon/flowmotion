import Link from "next/link";

import { Wordmark } from "@/components/shared/wordmark";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-2">
          <Wordmark />
          <p className="text-sm text-muted-foreground">
            Generates and exports n8n flows. Does not run them for you.
          </p>
        </div>
        <nav aria-label="Legal" className="flex items-center gap-6 text-sm">
          <Link href="/privacy" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
