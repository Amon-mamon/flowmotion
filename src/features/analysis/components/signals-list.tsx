import { RadarIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { COPY, SIGNAL_HEADING, fileLocation } from "@/features/analysis/copy";
import { SIGNAL_KINDS, type Signal } from "@/features/analysis/schemas";

/** Detected signals grouped by kind (design.md headings). Labels and paths are plain text. */
export function SignalsList({ signals }: { signals: Signal[] }) {
  return (
    <section aria-labelledby="signals-heading" className="flex flex-col gap-4">
      <h2 id="signals-heading" className="text-lg font-semibold">
        Detected signals
      </h2>
      {signals.length === 0 ? (
        <EmptyState icon={<RadarIcon />} title={COPY.noSignals} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {SIGNAL_KINDS.map((kind) => {
            const group = signals.filter((s) => s.kind === kind);
            if (group.length === 0) return null;
            const headingId = `signals-${kind}`;
            return (
              <section
                key={kind}
                aria-labelledby={headingId}
                data-signal-group={kind}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
              >
                <h3 id={headingId} className="text-sm font-medium">
                  {SIGNAL_HEADING[kind]} <span className="text-muted-foreground">({group.length})</span>
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.map((signal, index) => (
                    <li key={`${signal.filePath}:${signal.line ?? ""}:${signal.label}:${index}`} className="flex min-w-0 flex-col">
                      <span className="break-all font-mono text-sm">{signal.label}</span>
                      <span className="break-all font-mono text-xs text-muted-foreground">
                        {fileLocation(signal.filePath, signal.line)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
