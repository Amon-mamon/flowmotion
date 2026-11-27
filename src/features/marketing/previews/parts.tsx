import {
  FileIcon,
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  KeyRoundIcon,
  LockIcon,
} from "lucide-react";
import type { MotionValue } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/features/analysis/components/risk-badge";
import { SeverityBadge } from "@/features/analysis/components/severity-badge";
import { NodeIcon } from "@/features/flows/components/node-icon";
import { PREVIEW_LABELS, SECURITY } from "@/features/marketing/copy";
import {
  PREVIEW_BRANCH,
  PREVIEW_COMMIT,
  PREVIEW_FILE_STATE_LABEL,
  PREVIEW_FILES_SUMMARY,
  PREVIEW_FINDING,
  PREVIEW_JSON_LINES,
  PREVIEW_RECOMMENDATIONS,
  PREVIEW_REPO,
  PREVIEW_TREE,
  type PreviewRecommendation,
} from "@/features/marketing/preview-data";
import { ProgressFade, ProgressFadeBlock, ScannerBar } from "@/features/marketing/previews/progress";
import { cn } from "@/lib/utils";

/**
 * Preview parts built from the app's real presentational components
 * (SeverityBadge, RiskBadge, NodeIcon, Badge) with sample data. Always used
 * inside a PreviewRoot or ProductFrame, which make them decorative.
 */

const ICON_STROKE = 1.5;

const TRIGGER_NODE_TYPE: Readonly<Record<string, string>> = {
  Webhook: "n8n-nodes-base.webhook",
  Schedule: "n8n-nodes-base.scheduleTrigger",
};

/** One masked finding row, as on the analysis page. */
export function FindingRowPreview({ example = false, compact = false }: { example?: boolean; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-background", compact ? "gap-1.5 p-3" : "gap-2.5 p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        {example ? (
          <span className="fm-mono-label inline-flex h-6 items-center rounded-full border border-border px-2.5 text-muted-foreground">
            {SECURITY.exampleTag}
          </span>
        ) : null}
        <SeverityBadge severity={PREVIEW_FINDING.severity} />
        <span className="text-sm font-medium">{PREVIEW_FINDING.category}</span>
      </div>
      <p className="font-mono text-xs text-muted-foreground">{PREVIEW_FINDING.location}</p>
      <code className="w-fit rounded-lg bg-secondary px-2 py-1 font-mono text-xs text-foreground">
        {PREVIEW_FINDING.maskedEvidence}
      </code>
      {compact ? null : <p className="text-sm text-foreground">{PREVIEW_FINDING.remediation}</p>}
    </div>
  );
}

/** A recommendation card: trigger, title, confidence, credential, source file, risk badge. */
export function RecommendationCardPreview({
  recommendation,
  showFile = true,
}: {
  recommendation: PreviewRecommendation;
  showFile?: boolean;
}) {
  const nodeType = TRIGGER_NODE_TYPE[recommendation.trigger] ?? "n8n-nodes-base.webhook";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
            <NodeIcon nodeType={nodeType} className="size-3.5 text-primary" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium leading-5 text-foreground">{recommendation.title}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {recommendation.trigger} · {recommendation.confidence} confidence
            </span>
          </span>
        </div>
        <RiskBadge risk={recommendation.risk} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <KeyRoundIcon aria-hidden="true" />
          {recommendation.credential}
        </Badge>
        {showFile ? (
          <span className="truncate font-mono text-xs text-muted-foreground">{recommendation.sourceFile}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Two or three recommendation cards stacked. */
export function RecommendationsPreview({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {PREVIEW_RECOMMENDATIONS.slice(0, count).map((rec) => (
        <RecommendationCardPreview key={rec.title} recommendation={rec} />
      ))}
    </div>
  );
}

/**
 * Repository file tree with the branch; in `scan` mode each file shows Read or
 * Blocked for safety. With `scanProgress` (desktop story) a scanner bar
 * passes over the tree and each row's status, then the masked finding, fade
 * in as the bar reaches them.
 */
export function RepoTreePreview({
  mode,
  scanProgress,
}: {
  mode: "tree" | "scan";
  scanProgress?: MotionValue<number>;
}) {
  const rows = PREVIEW_TREE.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-xs text-foreground">{PREVIEW_REPO}</span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2 font-mono text-xs text-muted-foreground">
          <GitBranchIcon aria-hidden="true" strokeWidth={ICON_STROKE} className="size-3.5" />
          {PREVIEW_BRANCH}
        </span>
      </div>
      <div className="relative">
        <ul className="flex flex-col rounded-xl border border-border bg-background py-1.5">
          {PREVIEW_TREE.map((file, row) => {
            const blocked = file.state === "blocked";
            const Icon = file.kind === "dir" ? FolderIcon : blocked ? LockIcon : file.path.endsWith(".md") ? FileTextIcon : FileIcon;
            const status =
              mode === "scan" && file.state ? (
                <span
                  className={cn(
                    "block shrink-0 rounded-full border px-1.5 text-[10px] leading-4",
                    blocked ? "border-primary text-primary" : "border-border text-muted-foreground",
                  )}
                >
                  {PREVIEW_FILE_STATE_LABEL[file.state]}
                </span>
              ) : null;
            return (
              <li
                key={`${file.depth}-${file.path}`}
                className="flex h-[26px] items-center gap-2 px-3 font-mono text-xs"
                style={{ paddingLeft: `${12 + file.depth * 18}px` }}
              >
                <Icon
                  aria-hidden="true"
                  strokeWidth={ICON_STROKE}
                  className={cn("size-3.5 shrink-0", mode === "scan" && blocked ? "text-primary" : "text-muted-foreground")}
                />
                <span className={cn("min-w-0 flex-1 truncate", file.kind === "dir" ? "text-muted-foreground" : "text-foreground")}>
                  {file.path}
                </span>
                {status !== null && scanProgress !== undefined ? (
                  <ProgressFade progress={scanProgress} at={0.25 + (0.15 * (row + 0.5)) / rows} className="shrink-0">
                    {status}
                  </ProgressFade>
                ) : (
                  status
                )}
              </li>
            );
          })}
        </ul>
        {mode === "scan" && scanProgress !== undefined ? <ScannerBar progress={scanProgress} /> : null}
      </div>
      {mode === "scan" ? (
        scanProgress !== undefined ? (
          <ProgressFadeBlock progress={scanProgress} at={0.4}>
            <FindingRowPreview compact />
          </ProgressFadeBlock>
        ) : (
          <FindingRowPreview compact />
        )
      ) : null}
    </div>
  );
}

/** Short n8n JSON excerpt with a placeholder value. */
export function JsonSnippetPreview() {
  return (
    <pre className="max-w-full overflow-hidden rounded-xl border border-border bg-background p-4 font-mono text-xs leading-5 text-muted-foreground">
      {PREVIEW_JSON_LINES.map((line) => (
        <span key={line} className="block whitespace-pre">
          {highlightJsonLine(line)}
        </span>
      ))}
    </pre>
  );
}

/** Keys in white, the placeholder in accent; everything stays plain text. */
function highlightJsonLine(line: string) {
  const match = /^(\s*)("[^"]+")(:.*)$/.exec(line);
  if (match === null) return line;
  const [, indent, key, rest] = match;
  const placeholder = "YOUR_SLACK_CHANNEL";
  const at = rest!.indexOf(placeholder);
  return (
    <>
      {indent}
      <span className="text-foreground">{key}</span>
      {at === -1 ? (
        rest
      ) : (
        <>
          {rest!.slice(0, at)}
          <span className="text-primary">{placeholder}</span>
          {rest!.slice(at + placeholder.length)}
        </>
      )}
    </>
  );
}

/** Hero analysis preview: files summary, one masked finding, two recommendation cards. */
export function AnalysisPreview() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-4 text-sm">
        <span className="font-medium text-foreground">{PREVIEW_LABELS.analysis}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {PREVIEW_LABELS.branch} {PREVIEW_BRANCH} {PREVIEW_LABELS.at} {PREVIEW_COMMIT}
        </span>
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="text-foreground">{PREVIEW_FILES_SUMMARY.read}</span>
          <span className="text-border">/</span>
          <span>{PREVIEW_FILES_SUMMARY.skipped}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-muted-foreground">{PREVIEW_LABELS.findings}</p>
          <FindingRowPreview />
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-muted-foreground">{PREVIEW_LABELS.recommendations}</p>
          <RecommendationsPreview count={2} />
        </div>
      </div>
    </div>
  );
}
