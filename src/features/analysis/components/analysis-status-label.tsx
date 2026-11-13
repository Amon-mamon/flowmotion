import {
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileSearchIcon,
  SearchCheckIcon,
  SparklesIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { STATUS_LABEL } from "@/features/analysis/copy";
import type { AnalysisStatus } from "@/features/analysis/schemas";
import { cn } from "@/lib/utils";

const STATUS_ICON: Readonly<Record<AnalysisStatus, LucideIcon>> = {
  queued: ClockIcon,
  validating: SearchCheckIcon,
  scanning: FileSearchIcon,
  analyzing: SparklesIcon,
  done: CheckCircle2Icon,
  failed: XCircleIcon,
  rejected: BanIcon,
};

/** Icon plus label for an analysis status (design.md: shape and text, not extra colors). */
export function AnalysisStatusLabel({
  status,
  className,
}: {
  status: AnalysisStatus;
  className?: string;
}) {
  const Icon = STATUS_ICON[status];
  const alert = status === "failed" || status === "rejected";
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        alert ? "text-primary" : "text-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {STATUS_LABEL[status]}
    </span>
  );
}
