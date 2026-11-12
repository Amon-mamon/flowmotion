import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionProps = {
  id: string;
  title: string;
  eyebrow?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

/** Landing section with a semantic heading the section is labelled by. */
export function Section({ id, title, eyebrow, description, children, className }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("border-t border-border py-20 sm:py-28", className)}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 sm:px-8">
        <div className="flex max-w-2xl flex-col gap-3">
          {eyebrow ? (
            <p className="text-sm font-medium uppercase tracking-wide text-primary">{eyebrow}</p>
          ) : null}
          <h2 id={headingId} className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          {description ? <p className="text-base text-muted-foreground sm:text-lg">{description}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
