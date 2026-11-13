"use client";

import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { COPY } from "@/features/analysis/copy";
import { isActiveStatus } from "@/features/analysis/schemas";
import type { ProjectDetail } from "@/features/projects/schemas";
import { cn } from "@/lib/utils";

/** The newest analysis that is still `queued`..`analyzing`, if any. */
export function findActiveAnalysis(project: Pick<ProjectDetail, "analyses">) {
  return project.analyses.find((a) => isActiveStatus(a.status)) ?? null;
}

export function analysisHref(projectId: string, analysisId: string) {
  return `/projects/${encodeURIComponent(projectId)}/analysis/${encodeURIComponent(analysisId)}`;
}

/**
 * Analyze button (design.md): "View progress" link while an analysis is
 * active; disabled with the reconnect hint when the installation is gone.
 */
export function AnalyzeAction({
  project,
  onStart,
  isPending,
  label = "Analyze",
  currentAnalysisId,
  hintId,
}: {
  project: ProjectDetail;
  onStart: () => void;
  isPending: boolean;
  label?: string;
  /** On an analysis page: do not offer "View progress" for the page's own analysis. */
  currentAnalysisId?: string;
  hintId: string;
}) {
  const active = findActiveAnalysis(project);
  if (active && active.id !== currentAnalysisId) {
    return (
      <Link href={analysisHref(project.id, active.id)} className={cn(buttonVariants({ variant: "default" }))}>
        View progress
        <ArrowRightIcon aria-hidden="true" />
      </Link>
    );
  }
  if (active) return null;

  const disconnected = project.installationId === null;
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        onClick={onStart}
        disabled={disconnected || isPending}
        aria-describedby={disconnected ? hintId : undefined}
      >
        <SparklesIcon aria-hidden="true" />
        {isPending ? "Starting…" : label}
      </Button>
      {disconnected ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {COPY.reconnect}
        </span>
      ) : null}
    </div>
  );
}
