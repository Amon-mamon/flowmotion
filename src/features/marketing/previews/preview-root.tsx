import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Root of every decorative product preview (F8): hidden from screen readers,
 * inert (no focus, no pointer interaction), never holds a link, button, or
 * input. The text beside it carries the meaning.
 */
export function PreviewRoot({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-preview={name}
      aria-hidden="true"
      inert
      className={cn("pointer-events-none select-none", className)}
    >
      {children}
    </div>
  );
}

/**
 * Product frame: a card with a 36 px top bar (three neutral 8 px dots, then a
 * mono path label) holding a preview.
 */
export function ProductFrame({
  name,
  path,
  className,
  bodyClassName,
  children,
}: {
  name: string;
  path: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <PreviewRoot
      name={name}
      className={cn("overflow-hidden rounded-xl border border-border bg-card text-left", className)}
    >
      <div className="flex h-9 items-center gap-3 border-b border-border px-3.5">
        <span className="flex gap-1.5">
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
      </div>
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </PreviewRoot>
  );
}
