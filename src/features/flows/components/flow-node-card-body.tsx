import { KeyRoundIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { NodeIcon } from "@/features/flows/components/node-icon";
import { FLOW_COPY } from "@/features/flows/copy";
import { shortNodeType } from "@/features/flows/node-type";

/**
 * Visual part of a flow node card: icon, label, short type, and the key icon
 * when a credential is needed. Presentational only (no `@xyflow/react`, no
 * store), so the flow canvas and the landing page preview share it (F9).
 */
export function FlowNodeCardBody({
  label,
  nodeType,
  needsCredential,
}: {
  label: string;
  nodeType: string;
  needsCredential: boolean;
}) {
  return (
    <>
      <NodeIcon nodeType={nodeType} className="size-5 shrink-0 text-primary" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{shortNodeType(nodeType)}</span>
      </span>
      {needsCredential ? (
        <span className="shrink-0 text-muted-foreground" data-needs-credential="true">
          <KeyRoundIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">Needs a credential</span>
        </span>
      ) : null}
    </>
  );
}

/** Outlined "Trigger" tag that sits on the top edge of a trigger node card. */
export function FlowNodeTriggerTag() {
  return (
    <Badge
      variant="outline"
      className="pointer-events-none absolute -top-2.5 left-3 rounded-lg border-primary bg-background text-primary"
    >
      {FLOW_COPY.triggerTag}
    </Badge>
  );
}
