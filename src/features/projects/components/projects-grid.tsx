"use client";

import { FolderGit2Icon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstallations } from "@/features/github/queries";
import { AddRepositoryDialog } from "@/features/projects/components/add-repository-dialog";
import { ProjectCard } from "@/features/projects/components/project-card";
import { useProjects } from "@/features/projects/queries";
import { cn } from "@/lib/utils";

export function ProjectsGrid() {
  const projects = useProjects();
  // Needed only for the empty state: decides between "Add repository" and "Connect GitHub".
  const installations = useInstallations();
  const empty = projects.isSuccess && projects.data.length === 0;

  if (projects.isPending || (empty && installations.isPending)) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading projects"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-28 rounded-4xl" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (projects.isError) {
    return (
      <ErrorState
        title="Could not load projects"
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    );
  }

  if (projects.data.length === 0) {
    if (installations.isError) {
      return (
        <ErrorState
          title="Could not load GitHub connections"
          error={installations.error}
          onRetry={() => void installations.refetch()}
        />
      );
    }
    if (installations.data && installations.data.length > 0) {
      return (
        <EmptyState
          icon={<FolderGit2Icon />}
          title="No projects yet"
          description="Add a repository to analyze it."
          action={<AddRepositoryDialog />}
        />
      );
    }
    return (
      <EmptyState
        icon={<FolderGit2Icon />}
        title="No projects yet"
        description="Connect GitHub to choose a repository."
        action={
          // Plain anchors: these routes redirect to GitHub and must not be prefetched.
          <div className="flex flex-col items-center gap-3">
            <a href="/api/github/install" className={cn(buttonVariants({ size: "lg" }))}>
              Connect GitHub
            </a>
            <p className="text-sm text-muted-foreground">
              Already installed Flow Motion on GitHub?{" "}
              <a href="/api/github/authorize" className="text-primary underline-offset-4 hover:underline">
                Link existing installation
              </a>
            </p>
          </div>
        }
      />
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Projects">
      {projects.data.map((project) => (
        <li key={project.id}>
          <ProjectCard project={project} />
        </li>
      ))}
    </ul>
  );
}
