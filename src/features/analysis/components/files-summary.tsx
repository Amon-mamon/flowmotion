import { COPY, SKIPPED_LABEL } from "@/features/analysis/copy";
import type { AnalysisCounts } from "@/features/analysis/schemas";

type Row = { key: keyof typeof SKIPPED_LABEL; count: number };

/** Total skipped: blocked (denied + extension + size + cap) plus budget. */
export function totalSkipped(counts: AnalysisCounts): number {
  const r = counts.filesBlockedByReason;
  return r.denied + r.extension + r.size + r.cap + counts.filesSkippedBudget;
}

/** "Files" summary: read count plus skipped files grouped by reason (design.md). */
export function FilesSummary({ counts }: { counts: AnalysisCounts }) {
  const r = counts.filesBlockedByReason;
  const rows: Row[] = [
    { key: "denied", count: r.denied },
    { key: "extension", count: r.extension },
    { key: "size", count: r.size },
    { key: "cap", count: r.cap },
  ];
  // "Not sent to AI (size budget)" is hidden when 0.
  if (counts.filesSkippedBudget > 0) rows.push({ key: "budget", count: counts.filesSkippedBudget });

  return (
    <section aria-labelledby="files-heading" className="flex flex-col gap-4">
      <h2 id="files-heading" className="text-lg font-semibold">
        Files
      </h2>
      <div className="grid gap-4 rounded-xl border border-border bg-card p-6 md:grid-cols-[minmax(0,14rem)_1fr]">
        <dl className="flex flex-col gap-3">
          <div className="flex flex-col">
            <dt className="text-sm text-muted-foreground">Read</dt>
            <dd className="text-2xl font-semibold" data-testid="files-read">
              {counts.filesRead}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm text-muted-foreground">Considered</dt>
            <dd className="font-mono text-sm">{counts.filesConsidered}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Skipped <span data-testid="files-skipped" className="font-mono">{totalSkipped(counts)}</span>
          </h3>
          <dl className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <div key={row.key} data-reason={row.key} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="text-muted-foreground">{SKIPPED_LABEL[row.key]}</dt>
                <dd className="font-mono">{row.count}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{COPY.filesExplanation}</p>
    </section>
  );
}
