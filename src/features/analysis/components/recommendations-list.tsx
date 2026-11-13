"use client";

import {
  ArrowRightIcon,
  CalendarClockIcon,
  HandIcon,
  KeyRoundIcon,
  ListChecksIcon,
  Loader2Icon,
  WebhookIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COPY, TRIGGER_LABEL } from "@/features/analysis/copy";
import { ListSkeleton } from "@/features/analysis/components/section-states";
import { SeverityBadge } from "@/features/analysis/components/severity-badge";
import { useRecommendations } from "@/features/analysis/queries";
import type { Recommendation, TriggerKind } from "@/features/analysis/schemas";
import { cn } from "@/lib/utils";

const TRIGGER_ICON: Readonly<Record<TriggerKind, LucideIcon>> = {
  webhook: WebhookIcon,
  schedule: CalendarClockIcon,
  manual: HandIcon,
};

function RecommendationCard({
  recommendation: rec,
  checked,
  onToggle,
}: {
  recommendation: Recommendation;
  checked: boolean;
  onToggle: () => void;
}) {
  const TriggerIcon = TRIGGER_ICON[rec.triggerKind];
  const selectable = rec.status === "new";
  const checkboxId = `rec-${rec.id}`;
  const confidence = Math.round(rec.confidence * 100);

  return (
    <li
      data-recommendation={rec.id}
      data-selected={checked ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors",
        checked ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary disabled:opacity-50"
          checked={checked}
          disabled={!selectable}
          onChange={onToggle}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={checkboxId} className="cursor-pointer text-base font-medium leading-snug">
            {rec.title}
          </label>
          <p className="text-sm text-muted-foreground">{rec.description}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <TriggerIcon aria-hidden="true" />
          {TRIGGER_LABEL[rec.triggerKind]}
        </Badge>
        <Badge variant="outline">{confidence}% confidence</Badge>
        <SeverityBadge severity={rec.riskLevel} prefix="Risk:" />
        {rec.status === "selected" ? (
          <Badge variant="secondary">
            <Loader2Icon aria-hidden="true" className="animate-spin" />
            Generating
          </Badge>
        ) : null}
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">Required credentials</dt>
          <dd>
            {rec.requiredCredentials.length === 0 ? (
              <span>None</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {rec.requiredCredentials.map((credential) => (
                  <li key={credential}>
                    <Badge variant="secondary">
                      <KeyRoundIcon aria-hidden="true" />
                      {credential}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted-foreground">Source files</dt>
          <dd>
            {rec.sourceFiles.length === 0 ? (
              <span>None</span>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {rec.sourceFiles.map((file) => (
                  <li key={file} className="break-all font-mono text-xs">
                    {file}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      <p className="text-sm">
        <span className="text-muted-foreground">Why: </span>
        {rec.rationale}
      </p>

      {rec.status === "generated" && rec.flowId ? (
        <Link
          href={`/flows/${encodeURIComponent(rec.flowId)}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          Open flow
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </li>
  );
}

/** Selectable recommendation cards plus the (Phase 2: disabled) Generate button. */
export function RecommendationsList({ recommendations }: { recommendations: Recommendation[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  if (recommendations.length === 0) {
    return (
      <EmptyState
        icon={<ListChecksIcon />}
        title={COPY.noRecommendations}
        description="The analysis did not find an automation we could build from this repository."
      />
    );
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {recommendations.map((rec) => (
          <RecommendationCard
            key={rec.id}
            recommendation={rec}
            checked={selected.has(rec.id)}
            onToggle={() => toggle(rec.id)}
          />
        ))}
      </ul>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" aria-live="polite" data-testid="selected-count">
          {selected.size} selected
        </p>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {/* Phase 3 wires generation; the button stays disabled in Phase 2. */}
          <Button type="button" disabled aria-describedby="generate-hint">
            <WorkflowIcon aria-hidden="true" />
            Generate
          </Button>
          <span id="generate-hint" className="text-xs text-muted-foreground">
            {COPY.generateHint}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Recommendations section with loading, empty, and error states. */
export function RecommendationsSection({ projectId, analysisId }: { projectId: string; analysisId: string }) {
  const recs = useRecommendations(projectId, analysisId, true);
  return (
    <section aria-labelledby="recommendations-heading" className="flex flex-col gap-4">
      <h2 id="recommendations-heading" className="text-lg font-semibold">
        Recommendations
      </h2>
      {recs.isPending ? (
        <ListSkeleton label="Loading recommendations" />
      ) : recs.isError ? (
        <ErrorState title="Could not load recommendations" error={recs.error} onRetry={() => void recs.refetch()} />
      ) : (
        <RecommendationsList recommendations={recs.data.recommendations} />
      )}
    </section>
  );
}
