import {
  FileIcon,
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  KeyRoundIcon,
  LockIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/features/analysis/components/risk-badge";
import { SeverityBadge } from "@/features/analysis/components/severity-badge";
import { NodeIcon } from "@/features/flows/components/node-icon";
import {
  PREVIEW_BRANCH,
  PREVIEW_FILE_STATE_LABEL,
  PREVIEW_FILES_SUMMARY,
  PREVIEW_FINDING,
  PREVIEW_JSON_LINES,
  PREVIEW_RECOMMENDATIONS,
  PREVIEW_REPO,
  PREVIEW_TREE,
  type PreviewRecommendation,
} from "@/features/marketing/preview-data";
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
          <span className="fm-mono-label inline-flex h-5 items-center rounded-full border border-border px-2 text-[10px] text-muted-foreground">
            Example
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

/** Repository file tree with the branch; in `scan` mode each file shows Read or Blocked for safety. */
export function RepoTreePreview({ mode }: { mode: "tree" | "scan" }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-xs text-foreground">{PREVIEW_REPO}</span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2 font-mono text-xs text-muted-foreground">
          <GitBranchIcon aria-hidden="true" strokeWidth={ICON_STROKE} className="size-3.5" />
          {PREVIEW_BRANCH}
        </span>
      </div>
      <ul className="flex flex-col rounded-xl border border-border bg-background py-1.5">
        {PREVIEW_TREE.map((file) => {
          const blocked = file.state === "blocked";
          const Icon = file.kind === "dir" ? FolderIcon : blocked ? LockIcon : file.path.endsWith(".md") ? FileTextIcon : FileIcon;
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
              {mode === "scan" && file.state ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 text-[10px] leading-4",
                    blocked ? "border-primary text-primary" : "border-border text-muted-foreground",
                  )}
                >
                  {PREVIEW_FILE_STATE_LABEL[file.state]}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {mode === "scan" ? <FindingRowPreview compact /> : null}
    </div>
  );
}

/** Short n8n JSON excerpt with a placeholder value. */
export function JsonSnippetPreview() {
  return (
    <pre className="overflow-hidden rounded-xl border border-border bg-background p-4 font-mono text-xs leading-5 text-muted-foreground">
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
        <span className="font-medium text-foreground">Analysis</span>
        <span className="font-mono text-xs text-muted-foreground">
          Branch {PREVIEW_BRANCH} at 4f2c9e1
        </span>
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="text-foreground">{PREVIEW_FILES_SUMMARY.read}</span>
          <span className="text-border">/</span>
          <span>{PREVIEW_FILES_SUMMARY.skipped}</span>
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-muted-foreground">Security findings</p>
          <FindingRowPreview />
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-muted-foreground">Recommendations</p>
          <RecommendationsPreview count={2} />
        </div>
      </div>
    </div>
  );
}
