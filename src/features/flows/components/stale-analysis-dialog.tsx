"use client";

import { WorkflowIcon } from "lucide-react";
import Link from "next/link";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { FLOW_COPY } from "@/features/flows/copy";

type StaleAnalysisDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  analysisCommitSha: string | null;
  onGenerateAnyway: () => void;
  /** True while a generate request is in flight: the button is disabled. */
  pending?: boolean;
};

/**
 * Dialog for `PROJECT_STALE_ANALYSIS` (design.md "Card action area"):
 * "Generate anyway" repeats the request with `allowStale: true`; "Re-analyze"
 * goes to the project page; Esc closes it without a request.
 */
export function StaleAnalysisDialog({
  open,
  onOpenChange,
  projectId,
  analysisCommitSha,
  onGenerateAnyway,
  pending = false,
}: StaleAnalysisDialogProps) {
  const shortSha = analysisCommitSha ? analysisCommitSha.slice(0, 7) : null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-dialog="stale-analysis">
        <AlertDialogHeader>
          <AlertDialogTitle>{FLOW_COPY.staleTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {shortSha === null ? (
              `${FLOW_COPY.staleBody}.`
            ) : (
              <>
                {FLOW_COPY.staleBody} <span className="font-mono text-foreground">{shortSha}</span>.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className={buttonVariants({ variant: "outline" })}
          >
            {FLOW_COPY.reanalyze}
          </Link>
          <AlertDialogAction onClick={onGenerateAnyway} disabled={pending}>
            <WorkflowIcon aria-hidden="true" />
            {FLOW_COPY.generateAnyway}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
