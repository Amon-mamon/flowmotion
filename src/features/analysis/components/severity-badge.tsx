import { InfoIcon, OctagonAlertIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABEL } from "@/features/analysis/copy";
import type { Severity } from "@/features/analysis/schemas";

const SEVERITY_ICON: Readonly<Record<Severity, LucideIcon>> = {
  high: OctagonAlertIcon,
  medium: TriangleAlertIcon,
  low: InfoIcon,
};

/** Outlined red badge with a distinct icon and text per severity (design.md). */
export function SeverityBadge({ severity, prefix }: { severity: Severity; prefix?: string }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <Badge variant="destructive" data-severity={severity}>
      <Icon aria-hidden="true" />
      {prefix ? `${prefix} ` : ""}
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}
