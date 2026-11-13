"use client";

import { ShieldCheckIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CATEGORY_LABEL, COPY, SEVERITY_LABEL, SEVERITY_ORDER, fileLocation } from "@/features/analysis/copy";
import { ListSkeleton } from "@/features/analysis/components/section-states";
import { SeverityBadge } from "@/features/analysis/components/severity-badge";
import { useFindings } from "@/features/analysis/queries";
import type { Finding } from "@/features/analysis/schemas";

/** Evidence arrives masked from the server; the UI also caps its length as a second guard. */
const MAX_EVIDENCE = 120;
function displayEvidence(value: string): string {
  return value.length > MAX_EVIDENCE ? `${value.slice(0, MAX_EVIDENCE)}…` : value;
}

/** Masked findings grouped by severity. All repo-derived text is plain text. */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <EmptyState icon={<ShieldCheckIcon />} title={COPY.noFindings} />;
  }
  return (
    <div className="flex flex-col gap-6">
      {SEVERITY_ORDER.map((severity) => {
        const group = findings.filter((f) => f.severity === severity);
        if (group.length === 0) return null;
        const headingId = `findings-${severity}`;
        return (
          <section key={severity} aria-labelledby={headingId} data-severity-group={severity} className="flex flex-col gap-3">
            <h3 id={headingId} className="text-sm font-medium text-muted-foreground">
              {SEVERITY_LABEL[severity]} severity ({group.length})
            </h3>
            <ul className="flex flex-col gap-3">
              {group.map((finding) => (
                <li
                  key={finding.id}
                  data-finding={finding.id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-sm font-medium">{CATEGORY_LABEL[finding.category]}</span>
                  </div>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {fileLocation(finding.filePath, finding.line)}
                  </p>
                  <code
                    data-testid="masked-evidence"
                    className="w-fit max-w-full break-all rounded-lg bg-secondary px-2 py-1 font-mono text-xs"
                  >
                    {displayEvidence(finding.maskedEvidence)}
                  </code>
                  <p className="text-sm">{finding.remediation}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Findings section with loading, empty, and error states. */
export function FindingsSection({ projectId, analysisId }: { projectId: string; analysisId: string }) {
  const findings = useFindings(projectId, analysisId, true);
  return (
    <section aria-labelledby="findings-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="findings-heading" className="text-lg font-semibold">
          Security findings
        </h2>
        <p className="text-sm text-muted-foreground">Evidence is always shown masked.</p>
      </div>
      {findings.isPending ? (
        <ListSkeleton label="Loading findings" />
      ) : findings.isError ? (
        <ErrorState title="Could not load findings" error={findings.error} onRetry={() => void findings.refetch()} />
      ) : (
        <FindingsList findings={findings.data.findings} />
      )}
    </section>
  );
}
