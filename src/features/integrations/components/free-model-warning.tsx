import { TriangleAlertIcon } from "lucide-react";

import { INTEGRATIONS_COPY } from "@/features/integrations/copy";

/** Plain notice under a model that ends with `:free` (design.md). */
export function FreeModelWarning({ id }: { id?: string }) {
  return (
    <div
      id={id}
      role="note"
      className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>{INTEGRATIONS_COPY.freeModelWarning}</p>
    </div>
  );
}
