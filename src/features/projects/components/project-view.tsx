"use client";

import { AlertCircleIcon, GitBranchIcon, ListChecksIcon, ShieldAlertIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/features/api/client";
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

  return (
    <>
      <PageHeader
        title={project.repoFullName}
        badge={<ProjectStatusBadge project={project} />}
        description={
          <span className="inline-flex items-center gap-2">
            <GitBranchIcon aria-hidden="true" className="size-4" />
            <span className="font-mono">{project.defaultBranch}</span>
            <span aria-hidden="true">·</span>
            <span>Added {formatDate(project.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <div className="flex flex-col items-end gap-1">
              <Button type="button" disabled aria-describedby="analyze-hint">
                <SparklesIcon aria-hidden="true" />
                Analyze
              </Button>
              <span id="analyze-hint" className="text-xs text-muted-foreground">
                Analysis arrives in Phase 2
              </span>
            </div>
            <Button type="button" variant="outline" onClick={() => setDeleting(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete project
            </Button>
          </>
        }
      />

      {project.status === "invalid" && project.invalidReason ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>This repository was not recognized as a website or app</AlertTitle>
          <AlertDescription>{project.invalidReason}</AlertDescription>
        </Alert>
      ) : null}
      {project.installationId === null ? (
        <Alert>
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>Reconnect GitHub to analyze</AlertTitle>
          <AlertDescription>
            The GitHub installation for this repository was disconnected. Existing results stay
            available.{" "}
            <a href="/api/github/install">Reconnect GitHub</a>
          </AlertDescription>
        </Alert>
      ) : null}
      {project.stale ? (
        <Alert>
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>New commits since the last analysis</AlertTitle>
          <AlertDescription>Re-analyze to refresh findings and recommendations.</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="findings-heading" className="flex flex-col gap-4">
        <h2 id="findings-heading" className="text-lg font-semibold">
          Security findings
        </h2>
        <EmptyState
          icon={<ShieldAlertIcon />}
          title="No findings yet"
          description="Findings appear after an analysis. Evidence is always shown masked."
        />
      </section>

      <section aria-labelledby="recommendations-heading" className="flex flex-col gap-4">
        <h2 id="recommendations-heading" className="text-lg font-semibold">
          Recommendations
        </h2>
        <EmptyState
          icon={<ListChecksIcon />}
          title="No recommendations yet"
          description="Run an analysis to get a list of automations found in this repository."
        />
      </section>

      <DeleteProjectDialog
        project={project}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => router.push("/dashboard")}
      />
    </>
  );
}
