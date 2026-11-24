"use client";

import {
  CalendarClockIcon,
  HandIcon,
  KeyRoundIcon,
  ListChecksIcon,
  WebhookIcon,
  type LucideIcon,
} from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { COPY, TRIGGER_LABEL, recommendationsFoundText } from "@/features/analysis/copy";
import { ListSkeleton } from "@/features/analysis/components/section-states";
import { RiskBadge } from "@/features/analysis/components/risk-badge";
import { useRecommendations } from "@/features/analysis/queries";
import type { Recommendation, TriggerKind } from "@/features/analysis/schemas";
import { RecommendationAction } from "@/features/flows/components/recommendation-action";
import { FLOW_COPY } from "@/features/flows/copy";

const TRIGGER_ICON: Readonly<Record<TriggerKind, LucideIcon>> = {
  webhook: WebhookIcon,
  schedule: CalendarClockIcon,
  manual: HandIcon,
};

/** One recommendation: no checkbox and no selected state (D-42); each card starts its own flow. */
function RecommendationCard({ recommendation: rec }: { recommendation: Recommendation }) {
  const TriggerIcon = TRIGGER_ICON[rec.triggerKind];
  const confidence = Math.round(rec.confidence * 100);

  return (
    <li
      data-recommendation={rec.id}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-base leading-snug font-medium">{rec.title}</h3>
        <p className="text-sm text-muted-foreground">{rec.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <TriggerIcon aria-hidden="true" />
          {TRIGGER_LABEL[rec.triggerKind]}
        </Badge>
        <Badge variant="outline">{confidence}% confidence</Badge>
        <RiskBadge risk={rec.riskLevel} />
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

      <RecommendationAction recommendation={rec} />
    </li>
  );
}

/** Recommendation cards, each with its own action area, plus the helper text under the list. */
export function RecommendationsList({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <EmptyState
        icon={<ListChecksIcon />}
        title={COPY.noRecommendations}
        description="The analysis did not find an automation we could build from this repository."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {recommendations.map((rec) => (
          <RecommendationCard key={rec.id} recommendation={rec} />
        ))}
      </ul>
      <p className="text-sm text-muted-foreground" data-testid="generate-helper">
        {FLOW_COPY.generateHelper}
      </p>
    </div>
  );
}

/**
 * Recommendations section with loading, empty, and error states. `showCount`
 * enables the count line (design.md, Phase 2d): only for a `done` analysis
 * with `errorCode` null, and only once the list has loaded.
 */
export function RecommendationsSection({
  projectId,
  analysisId,
  showCount = false,
}: {
  projectId: string;
  analysisId: string;
  showCount?: boolean;
}) {
  const recs = useRecommendations(projectId, analysisId, true);
  const countText = showCount && recs.isSuccess ? recommendationsFoundText(recs.data.recommendations.length) : null;
  return (
    <section aria-labelledby="recommendations-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="recommendations-heading" className="text-lg font-semibold">
          Recommendations
        </h2>
        {countText ? (
          <p className="text-sm text-muted-foreground" data-testid="recommendations-count">
            {countText}
          </p>
        ) : null}
      </div>
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
