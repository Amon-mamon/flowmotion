"use client";

import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ParamTree } from "@/features/flows/components/param-tree";
import { FLOW_COPY, credentialText } from "@/features/flows/copy";
import { shortNodeType } from "@/features/flows/graph";
import type { FlowNodeView } from "@/features/flows/schemas";
import { useMediaQuery } from "@/hooks/use-media-query";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Node inspector drawer (design.md): right side, bottom sheet on small
 * screens; closed with Esc or the close button. Read-only in v1; every value
 * is plain text.
 */
export function NodeInspector({ node, onClose }: { node: FlowNodeView | null; onClose: () => void }) {
  const wide = useMediaQuery("(min-width: 640px)", true);

  return (
    <Sheet
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {node !== null ? (
        <SheetContent
          side={wide ? "right" : "bottom"}
          className="gap-0 overflow-y-auto data-[side=bottom]:max-h-[80dvh] data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="pr-12">
            <SheetTitle className="text-lg break-words">{node.label}</SheetTitle>
            <SheetDescription className="sr-only">Node details. Read-only.</SheetDescription>
          </SheetHeader>
          <dl className="flex flex-col gap-5 px-4 pb-6">
            <Row label={FLOW_COPY.typeRow}>
              <span className="block" data-testid="inspector-short-type">
                {shortNodeType(node.nodeType)}
              </span>
              <span className="block font-mono text-xs break-all text-muted-foreground">{node.nodeType}</span>
            </Row>
            <Row label={FLOW_COPY.parametersRow}>
              <ParamTree params={node.params} />
            </Row>
            <Row label={FLOW_COPY.credentialRow}>{credentialText(node.credential)}</Row>
            <Row label={FLOW_COPY.sourceFilesRow}>
              {node.sourceFiles.length === 0 ? (
                <span className="text-muted-foreground">{FLOW_COPY.noSourceFiles}</span>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {node.sourceFiles.map((file) => (
                    <li key={file} className="font-mono text-xs break-all">
                      {file}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            {node.notes !== null ? (
              <Row label={FLOW_COPY.notesRow}>
                <span className="break-words whitespace-pre-wrap">{node.notes}</span>
              </Row>
            ) : null}
          </dl>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
