import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-primary" />
      Flow Motion
    </Link>
  );
}
