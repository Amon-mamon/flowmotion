"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, GitCommitHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useRef } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/features/api/client";
import { AnalysisProgress } from "@/features/analysis/components/analysis-progress";
import { AnalysisStatusLabel } from "@/features/analysis/components/analysis-status-label";
import {
  AiDisabledNotice,
  FailedNotice,
  ReanalyzeButton,
  ReconnectNotice,
  StaleNotice,
} from "@/features/analysis/components/analysis-notices";
import { AnalyzeAction } from "@/features/analysis/components/analyze-action";
import { AnalyzeErrorNotice } from "@/features/analysis/components/analyze-error-notice";
import { FilesSummary } from "@/features/analysis/components/files-summary";
import { FindingsSection } from "@/features/analysis/components/findings-list";
import { RecommendationsSection } from "@/features/analysis/components/recommendations-list";
import { SignalsList } from "@/features/analysis/components/signals-list";
import { ValidationResult } from "@/features/analysis/components/validation-result";
import { shortSha } from "@/features/analysis/copy";
import { useAnalysis } from "@/features/analysis/queries";
import { isActiveStatus, isTerminalStatus, type Analysis } from "@/features/analysis/schemas";
import { useStartAnalysis } from "@/features/analysis/use-start-analysis";
import { projectKeys, useProject } from "@/features/projects/queries";
import type { ProjectDetail } from "@/features/projects/schemas";
import { formatDate } from "@/hooks/use-format-date";

type Props = { projectId: string; analysisId: string; pollIntervalMs?: number };

/** `analyses.progress` once the `detect` step is reached (contract section 4). */
const DETECT_PROGRESS = 70;

/** `/projects/[projectId]/analysis/[analysisId]`: progress, validity, files, findings, signals, recommendations. */
export function AnalysisView({ projectId, analysisId, pollIntervalMs }: Props) {
  const analysis = useAnalysis(analysisId, { pollIntervalMs });
  const project = useProject(projectId);
  const queryClient = useQueryClient();

  // When polling reaches a terminal status, refresh the project (status, stale, history).
  const status = analysis.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (before && status && isActiveStatus(before) && isTerminalStatus(status)) {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    }
  }, [status, projectId, queryClient]);

  if (analysis.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading analysis" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (analysis.isError) {
    const code = analysis.error instanceof ApiError ? analysis.error.code : null;
    // Unknown, foreign, or malformed id → Next 404.
    if (code === "NOT_FOUND" || code === "VALIDATION_ERROR") return notFound();
    return (
      <ErrorState title="Could not load analysis" error={analysis.error} onRetry={() => void analysis.refetch()} />
    );
  }

  // The analysis must belong to the project in the URL.
  if (analysis.data.projectId !== projectId) return notFound();

  return <AnalysisBody analysis={analysis.data} project={project.data} projectId={projectId} />;
}

function AnalysisBody({
  analysis,
  project,
  projectId,
}: {
  analysis: Analysis;
  project: ProjectDetail | undefined;
  projectId: string;
}) {
  const start = useStartAnalysis(projectId);
  const active = isActiveStatus(analysis.status);
  const disconnected = project?.installationId === null;
  const stale =
    !active &&
    project !== undefined &&
    project.stale &&
    project.lastCommitSha !== null &&
    analysis.commitSha !== project.lastCommitSha;

  // Findings exist from `detect` onward (progress 70, contract section 4), also on a
  // `failed` analysis whose `ai` step failed. Empty lists render their own empty state.
  const showResults =
    analysis.status === "done" ||
    (analysis.status === "failed" &&
      (analysis.progress >= DETECT_PROGRESS ||
        analysis.errorCode === "MODEL_OUTPUT_INVALID" ||
        analysis.errorCode === "AI_UNAVAILABLE" ||
        analysis.signals.length > 0));

  return (
    <>
      <PageHeader
        title="Analysis"
        badge={<AnalysisStatusLabel status={analysis.status} />}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href={`/projects/${encodeURIComponent(projectId)}`} className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              {project?.repoFullName ?? "Back to project"}
            </Link>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1" data-testid="analysis-branch-line">
              <GitCommitHorizontalIcon aria-hidden="true" className="size-4" />
              Branch <span className="font-mono text-foreground">{analysis.branch}</span>
              {analysis.commitSha ? (
                <>
                  {" "}at <span className="font-mono text-foreground">{shortSha(analysis.commitSha)}</span>
                </>
              ) : null}
            </span>
            {analysis.startedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Started {formatDate(analysis.startedAt)}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          project && (analysis.status === "done" || analysis.status === "rejected") ? (
            <AnalyzeAction
              project={project}
              onStart={start.start}
              isPending={start.isPending}
              label="Analyze again"
              currentAnalysisId={analysis.id}
              hintId="analysis-analyze-hint"
            />
          ) : null
        }
      />

      {start.error ? <AnalyzeErrorNotice error={start.error} /> : null}
      {disconnected ? <ReconnectNotice /> : null}
      {stale ? (
        <StaleNotice
          action={
            disconnected ? undefined : <ReanalyzeButton onClick={start.start} disabled={start.isPending} />
          }
        />
      ) : null}

      {active ? <AnalysisProgress analysis={analysis} /> : null}

      {analysis.status === "failed" ? (
        <FailedNotice
          errorCode={analysis.errorCode}
          branch={analysis.branch}
          // BRANCH_NOT_FOUND: re-analyzing would fail the same way (design.md).
          onRetry={analysis.errorCode === "BRANCH_NOT_FOUND" ? undefined : start.start}
          retryDisabled={start.isPending || disconnected}
        />
      ) : null}

      <ValidationResult validation={analysis.validation} />

      {showResults ? (
        <>
          <FilesSummary counts={analysis.counts} />
          <FindingsSection projectId={projectId} analysisId={analysis.id} />
          <SignalsList signals={analysis.signals} />
        </>
      ) : null}

      {analysis.status === "done" ? (
        analysis.errorCode === "AI_DISABLED" ? (
          <section aria-labelledby="recommendations-heading" className="flex flex-col gap-4">
            <h2 id="recommendations-heading" className="text-lg font-semibold">
              Recommendations
            </h2>
            <AiDisabledNotice />
          </section>
        ) : (
          <RecommendationsSection
            projectId={projectId}
            analysisId={analysis.id}
            analysisCommitSha={analysis.commitSha}
            showCount={analysis.errorCode === null}
          />
        )
      ) : null}
    </>
  );
}
