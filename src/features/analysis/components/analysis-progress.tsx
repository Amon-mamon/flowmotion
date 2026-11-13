import { CheckCircle2Icon, CircleIcon, Loader2Icon } from "lucide-react";

import { ACTIVE_STEPS, STATUS_LABEL } from "@/features/analysis/copy";
import type { Analysis } from "@/features/analysis/schemas";
import { cn } from "@/lib/utils";

/** Progress bar with step labels while the analysis is `queued`..`analyzing`. */
export function AnalysisProgress({ analysis }: { analysis: Pick<Analysis, "status" | "progress"> }) {
  const label = STATUS_LABEL[analysis.status];
  const currentIndex = ACTIVE_STEPS.findIndex((step) => step === analysis.status);
  const progress = Math.min(100, Math.max(0, analysis.progress));

  return (
    <section aria-labelledby="progress-heading" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="progress-heading" className="text-lg font-semibold">
          {label}
        </h2>
        <span className="font-mono text-sm text-muted-foreground">{progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${label}, ${progress}%`}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Analysis steps">
        {ACTIVE_STEPS.map((step, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
          return (
            <li
              key={step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-sm",
                state === "upcoming" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {state === "done" ? (
                <CheckCircle2Icon aria-hidden="true" className="size-4 text-primary" />
              ) : state === "current" ? (
                <Loader2Icon aria-hidden="true" className="size-4 animate-spin text-primary" />
              ) : (
                <CircleIcon aria-hidden="true" className="size-4" />
              )}
              <span>{STATUS_LABEL[step]}</span>
              <span className="sr-only">
                {state === "done" ? "(complete)" : state === "current" ? "(in progress)" : "(not started)"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground">
        This page updates on its own. You can leave and come back later.
      </p>
    </section>
  );
}
