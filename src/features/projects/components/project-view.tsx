"use client";

import { AlertCircleIcon, ArrowRightIcon, GitBranchIcon, ListChecksIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/features/api/client";
import { ReanalyzeButton, ReconnectNotice, StaleNotice } from "@/features/analysis/components/analysis-notices";
import { AnalysisStatusLabel } from "@/features/analysis/components/analysis-status-label";
import { AnalyzeAction, analysisHref, findActiveAnalysis } from "@/features/analysis/components/analyze-action";
import { AnalyzeErrorNotice } from "@/features/analysis/components/analyze-error-notice";
import { COPY, shortSha } from "@/features/analysis/copy";
import { isAnalyzeApiReady } from "@/features/analysis/readiness";
import { isActiveStatus } from "@/features/analysis/schemas";
import { useStartAnalysis } from "@/features/analysis/use-start-analysis";
import { DeleteProjectDialog } from "@/features/projects/components/delete-project-dialog";
import { ProjectStatusBadge } from "@/features/projects/components/project-status-badge";
import { useProject } from "@/features/projects/queries";
import type { ProjectDetail } from "@/features/projects/schemas";
import { formatDate } from "@/hooks/use-format-date";
import { cn } from "@/lib/utils";

export function ProjectView({ projectId }: { projectId: string }) {
  const project = useProject(projectId);

  if (project.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading project" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (project.isError) {
    if (project.error instanceof ApiError && project.error.code === "NOT_FOUND") {
      return (
        <EmptyState
          title="Project not found"
          description="It may have been deleted, or the link is wrong."
          action={
            <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
              Back to dashboard
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Could not load project"
        error={project.error}
        onRetry={() => void project.refetch()}
      />
    );
  }

  return <ProjectBody project={project.data} />;
}

function ProjectBody({ project }: { project: ProjectDetail }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const start = useStartAnalysis(project.id);
  const disconnected = project.installationId === null;
  const active = findActiveAnalysis(project);
  // R11-2: no live Analyze until the Analyze API is marked ready in docs/status.md.
  const analyzeReady = isAnalyzeApiReady();

  return (
    <>
      <PageHeader
        title={project.repoFullName}
        badge={<ProjectStatusBadge project={project} />}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <GitBranchIcon aria-hidden="true" className="size-4" />
            <span>Branch</span>
            <span className="font-mono text-foreground" data-testid="project-branch">
              {project.branch}
            </span>
            {project.branch === project.defaultBranch ? <Badge variant="outline">default</Badge> : null}
            <span aria-hidden="true">·</span>
            <span>Added {formatDate(project.createdAt)}</span>
          </span>
        }
        actions={
          <>
            {analyzeReady ? (
              <AnalyzeAction
                project={project}
                onStart={start.start}
                isPending={start.isPending}
                hintId="analyze-hint"
              />
            ) : (
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Button type="button" disabled aria-describedby="analyze-hint">
                  <SparklesIcon aria-hidden="true" />
                  Analyze
                </Button>
                <span id="analyze-hint" className="text-xs text-muted-foreground">
                  Analysis arrives in Phase 2
                </span>
              </div>
            )}
            <Button type="button" variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete project
            </Button>
          </>
        }
      />

      {start.error ? <AnalyzeErrorNotice error={start.error} /> : null}
      {project.status === "invalid" && project.invalidReason ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>This repository was not recognized as a website or app</AlertTitle>
          <AlertDescription>
            <p>{project.invalidReason}</p>
            {analyzeReady ? <p>If you changed the repository, analyze it again.</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {disconnected ? <ReconnectNotice /> : null}
      {project.stale ? (
        <StaleNotice
          action={
            !analyzeReady || disconnected || active ? undefined : (
              <ReanalyzeButton onClick={start.start} disabled={start.isPending} />
            )
          }
        />
      ) : null}

      {analyzeReady ? (
        <AnalysesHistory project={project} />
      ) : (
        <section aria-labelledby="latest-heading" className="flex flex-col gap-4">
          <h2 id="latest-heading" className="text-lg font-semibold">
            Analysis
          </h2>
          <EmptyState
            icon={<ListChecksIcon />}
            title={COPY.notAnalyzed}
            description="Analysis arrives in Phase 2. It will check that this is a website or app, scan it for exposed secrets, and list the automations it contains."
          />
        </section>
      )}

      <DeleteProjectDialog
        project={project}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => router.push("/dashboard")}
      />
    </>
  );
}

function AnalysesHistory({ project }: { project: ProjectDetail }) {
  const [latest] = project.analyses;
  return (
    <>
      <section aria-labelledby="latest-heading" className="flex flex-col gap-4">
        <h2 id="latest-heading" className="text-lg font-semibold">
          Latest analysis
        </h2>
        {latest ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <AnalysisStatusLabel status={latest.status} />
              <p className="text-sm text-muted-foreground">
                <span className="font-mono">{shortSha(latest.commitSha)}</span>
                {latest.startedAt ? <> · Started {formatDate(latest.startedAt)}</> : null}
              </p>
            </div>
            <Link
              href={analysisHref(project.id, latest.id)}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              {isActiveStatus(latest.status) ? "View progress" : "View results"}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={<ListChecksIcon />}
            title={COPY.notAnalyzed}
            description="Press Analyze to check that this is a website or app, scan it for exposed secrets, and list the automations it contains."
          />
        )}
      </section>

      {project.analyses.length > 0 ? (
        <section aria-labelledby="history-heading" className="flex flex-col gap-4">
          <h2 id="history-heading" className="text-lg font-semibold">
            History
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {project.analyses.map((analysis) => (
              <li key={analysis.id}>
                <Link
                  href={analysisHref(project.id, analysis.id)}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-secondary sm:flex-row sm:items-center sm:justify-between"
                >
                  <AnalysisStatusLabel status={analysis.status} />
                  <span className="text-sm text-muted-foreground">
                    <span className="font-mono">{shortSha(analysis.commitSha)}</span>
                    {analysis.startedAt ? <> · {formatDate(analysis.startedAt)}</> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
