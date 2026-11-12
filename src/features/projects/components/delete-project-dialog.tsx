"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeError } from "@/features/api/client";
import { useDeleteProject } from "@/features/projects/queries";
import type { Project } from "@/features/projects/schemas";

type DeleteProjectDialogProps = {
  project: Pick<Project, "id" | "repoFullName">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** Confirm dialog for `DELETE /api/projects/:id`. */
export function DeleteProjectDialog({ project, open, onOpenChange, onDeleted }: DeleteProjectDialogProps) {
  const remove = useDeleteProject();
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (remove.isPending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  function confirm() {
    setError(null);
    remove.mutate(project.id, {
      onSuccess: () => {
        onOpenChange(false);
        onDeleted?.();
      },
      onError: (err) => setError(describeError(err)),
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {project.repoFullName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the project and all of its analyses, findings, recommendations, flows,
            and test runs from Flow Motion. Your repository on GitHub is not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} disabled={remove.isPending}>
            <Trash2Icon aria-hidden="true" />
            {remove.isPending ? "Deleting…" : "Delete project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
