import { CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Project } from "@/features/projects/schemas";

/**
 * Status to UI mapping from docs/design.md: shape and text, not extra colors.
 * pending → "Not analyzed yet"; valid → kind; invalid → outlined badge.
 */
export function ProjectStatusBadge({
  project,
}: {
  project: Pick<Project, "status" | "detectedKind">;
}) {
  switch (project.status) {
    case "pending":
      return (
        <Badge variant="secondary" data-status="pending">
          <CircleDashedIcon aria-hidden="true" />
          Not analyzed yet
        </Badge>
      );
    case "valid":
      return (
        <Badge variant="default" data-status="valid">
          <CheckCircle2Icon aria-hidden="true" />
          Valid{project.detectedKind ? ` · ${project.detectedKind}` : ""}
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="outline" className="border-primary text-primary" data-status="invalid">
          <XCircleIcon aria-hidden="true" />
          Invalid
        </Badge>
      );
  }
}
