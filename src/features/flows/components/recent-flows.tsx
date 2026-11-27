"use client";

import { AlertCircleIcon, CheckIcon, Loader2Icon, WorkflowIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { FLOW_COPY } from "@/features/flows/copy";
import { useFlows } from "@/features/flows/queries";
import type { FlowStatus } from "@/features/flows/schemas";
import { formatDate } from "@/hooks/use-format-date";

const STATUS: Readonly<Record<FlowStatus, { label: string; Icon: LucideIcon; iconClass: string }>> = {
  generating: { label: FLOW_COPY.statusGenerating, Icon: Loader2Icon, iconClass: "animate-spin text-muted-foreground" },
  ready: { label: FLOW_COPY.statusReady, Icon: CheckIcon, iconClass: "text-primary" },
  failed: { label: FLOW_COPY.statusFailed, Icon: AlertCircleIcon, iconClass: "text-primary" },
};

/** "No flows yet" empty state (design.md Dashboard "Recent flows"). */
export function RecentFlowsEmpty() {
  return <EmptyState icon={<WorkflowIcon />} title={FLOW_COPY.noFlows} description={FLOW_COPY.noFlowsDescription} />;
}

/**
 * Dashboard "Recent flows" (design.md, Phase 3b): up to 20 rows from
 * `GET /api/flows`, each linking to its flow page. Names and repo names are
 * plain text.
 */
export function RecentFlows() {
  const flows = useFlows();

  if (flows.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label={FLOW_COPY.loadingFlows} className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (flows.isError) {
    return <ErrorState title={FLOW_COPY.flowsLoadFailed} error={flows.error} onRetry={() => void flows.refetch()} />;
  }
  if (flows.data.length === 0) return <RecentFlowsEmpty />;

  return (
    <ul className="flex flex-col gap-2">
      {flows.data.slice(0, 20).map((flow) => {
        const { label, Icon, iconClass } = STATUS[flow.status];
        return (
          <li key={flow.id}>
            <Link
              href={`/flows/${encodeURIComponent(flow.id)}`}
              data-flow={flow.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:border-ring focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{flow.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{flow.repoFullName}</span>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5" data-status={flow.status}>
                  <Icon aria-hidden="true" className={`size-4 ${iconClass}`} />
                  {label}
                </span>
                <span className="text-muted-foreground">{formatDate(flow.createdAt)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
