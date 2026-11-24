"use client";

import { CheckIcon, Loader2Icon, WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Recommendation } from "@/features/analysis/schemas";
import { FLOW_COPY } from "@/features/flows/copy";
import { useGenerate } from "@/features/flows/queries";
import { isGenerateApiReady } from "@/features/flows/readiness";

const linkClass = "text-sm text-primary underline-offset-4 hover:underline";
const flowHref = (flowId: string) => `/flows/${encodeURIComponent(flowId)}`;

/**
 * Action area at the bottom of a recommendation card (design.md "Card action
 * area", D-42): one deliberate "Generate flow" per card, no selection state.
 */
export function RecommendationAction({
  recommendation,
}: {
  recommendation: Pick<Recommendation, "id" | "status" | "flowId">;
}) {
  const { id, status, flowId } = recommendation;
  const router = useRouter();
  const generate = useGenerate();
  const hintId = useId();
  const ready = isGenerateApiReady();

  if (status === "selected") {
    return (
      <div className="flex flex-wrap items-center gap-3" data-action="generating">
        <Badge variant="secondary">
          <Loader2Icon aria-hidden="true" className="animate-spin" />
          {FLOW_COPY.generatingBadge}
        </Badge>
        {flowId !== null ? (
          <Link href={flowHref(flowId)} className={linkClass}>
            {FLOW_COPY.viewProgress}
          </Link>
        ) : null}
      </div>
    );
  }

  if (status === "generated") {
    return (
      <div className="flex flex-wrap items-center gap-3" data-action="ready">
        <Badge variant="outline" className="rounded-lg border-primary text-primary">
          <CheckIcon aria-hidden="true" />
          {FLOW_COPY.flowReady}
        </Badge>
        {flowId !== null ? (
          <Link href={flowHref(flowId)} className={linkClass}>
            {FLOW_COPY.openFlow}
          </Link>
        ) : null}
      </div>
    );
  }

  // `new`: first attempt, or "Try again" when the newest flow failed (D-41).
  const retry = flowId !== null;
  const start = () =>
    generate.mutate(
      { recommendationId: id },
      {
        onSuccess: ({ flowIds }) => {
          const created = flowIds[0];
          if (created !== undefined) router.push(flowHref(created));
        },
      },
    );

  return (
    <div className="flex flex-col gap-2" data-action={retry ? "retry" : "new"}>
      {retry ? (
        <p className="text-sm text-muted-foreground">
          {FLOW_COPY.lastAttemptFailed}{" "}
          <Link href={flowHref(flowId)} className={linkClass}>
            {FLOW_COPY.viewDetails}
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {ready ? (
          <Button type="button" disabled={generate.isPending} onClick={start}>
            <WorkflowIcon aria-hidden="true" />
            {generate.isPending ? FLOW_COPY.generatePending : retry ? FLOW_COPY.tryAgain : FLOW_COPY.generate}
          </Button>
        ) : (
          <>
            <Button type="button" disabled aria-describedby={hintId}>
              <WorkflowIcon aria-hidden="true" />
              {retry ? FLOW_COPY.tryAgain : FLOW_COPY.generate}
            </Button>
            <span id={hintId} className="text-xs text-muted-foreground">
              {FLOW_COPY.generateNotReady}
            </span>
          </>
        )}
      </div>
      {ready && generate.isError ? (
        <p role="alert" data-notice="generate-error" className="text-sm">
          {FLOW_COPY.generateFailed}
        </p>
      ) : null}
    </div>
  );
}
