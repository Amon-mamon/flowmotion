import Link from "next/link";

import { Wordmark } from "@/components/shared/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/login" className={cn(buttonVariants({ variant: "ghost" }))}>
            Log in
          </Link>
          <Link href="/signup" className={cn(buttonVariants({ variant: "default" }))}>
            Sign up
          </Link>
        </nav>
      </div>
    </header>
  );
}
