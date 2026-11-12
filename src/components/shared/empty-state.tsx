import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** Solid, bordered empty state used by every list (docs/design.md). */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-6">
          {icon}
        </span>
      ) : null}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
