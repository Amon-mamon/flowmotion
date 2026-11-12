import Link from "next/link";

import { Wordmark } from "@/components/shared/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <Wordmark />
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-md text-muted-foreground">The page you asked for does not exist or was moved.</p>
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to the start
      </Link>
    </main>
  );
}
