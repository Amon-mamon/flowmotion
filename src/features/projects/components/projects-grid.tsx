"use client";

import { FolderGit2Icon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/features/projects/components/project-card";
import { useProjects } from "@/features/projects/queries";
import { cn } from "@/lib/utils";

export function ProjectsGrid() {
  const projects = useProjects();

  if (projects.isPending) {
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
    return (
      <EmptyState
        icon={<FolderGit2Icon />}
        title="No projects yet"
        description="Connect GitHub, then add a repository to start finding automations."
        action={
          // Plain anchor: this route redirects to GitHub and must not be prefetched.
          <a href="/api/github/install" className={cn(buttonVariants({ size: "lg" }))}>
            Connect GitHub
          </a>
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
