"use client";

import { GitBranchIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteProjectDialog } from "@/features/projects/components/delete-project-dialog";
import { ProjectStatusBadge } from "@/features/projects/components/project-status-badge";
import type { Project } from "@/features/projects/schemas";
import { formatDate } from "@/hooks/use-format-date";

export function ProjectCard({ project }: { project: Project }) {
  const [deleting, setDeleting] = useState(false);
  const href = `/projects/${encodeURIComponent(project.id)}`;

  return (
    <Card data-testid="project-card" className="h-full">
      <CardHeader>
        <CardTitle className="min-w-0">
          <Link
            href={href}
            className="block truncate rounded-sm underline-offset-4 hover:text-primary hover:underline"
          >
            {project.repoFullName}
          </Link>
        </CardTitle>
        <div className="col-start-2 row-start-1 self-start justify-self-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${project.repoFullName}`}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2Icon aria-hidden="true" />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ProjectStatusBadge project={project} />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitBranchIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">Branch </span>
          <span className="truncate font-mono" data-testid="project-branch">
            {project.branch}
          </span>
        </p>
      </CardContent>
      <CardFooter className="justify-between text-xs text-muted-foreground">
        <span>Added {formatDate(project.createdAt)}</span>
        <Link href={href} className="text-primary underline-offset-4 hover:underline">
          Open
        </Link>
      </CardFooter>
      <DeleteProjectDialog project={project} open={deleting} onOpenChange={setDeleting} />
    </Card>
  );
}
