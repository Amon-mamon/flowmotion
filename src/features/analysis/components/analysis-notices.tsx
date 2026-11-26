import { GitCommitHorizontalIcon, InfoIcon, PlugIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { COPY, failedMessage } from "@/features/analysis/copy";
import type { JobErrorCode } from "@/features/analysis/schemas";

/** done + AI_DISABLED: plain notice in place of recommendations, no error styling, no button. */
export function AiDisabledNotice() {
  return (
    <div
      role="status"
      data-notice="ai-disabled"
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm"
    >
      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p>{COPY.aiDisabled}</p>
    </div>
  );
}

/** installation_id = null: "Reconnect GitHub to analyze". */
export function ReconnectNotice() {
  return (
    <Alert data-notice="reconnect">
      <PlugIcon aria-hidden="true" />
      <AlertTitle>{COPY.reconnect}</AlertTitle>
      <AlertDescription>
        <p>
          The GitHub installation for this repository was disconnected. Existing results stay available.{" "}
          <a href="/api/github/authorize">Reconnect GitHub</a>
        </p>
        <p>{COPY.reconnectOtherAccount}</p>
      </AlertDescription>
    </Alert>
  );
}

/** stale = true: "New commits since the last analysis" with Re-analyze. */
export function StaleNotice({ action }: { action?: ReactNode }) {
  return (
    <Alert data-notice="stale">
      <GitCommitHorizontalIcon aria-hidden="true" />
      <AlertTitle>{COPY.stale}</AlertTitle>
      <AlertDescription>
        <p>Re-analyze to refresh findings and recommendations.</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </AlertDescription>
    </Alert>
  );
}

export function ReanalyzeButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <RefreshCwIcon aria-hidden="true" />
      Re-analyze
    </Button>
  );
}

/** failed: friendly message per error code plus a Retry (Analyze) button. */
export function FailedNotice({
  errorCode,
  branch,
  onRetry,
  retryDisabled,
}: {
  errorCode: JobErrorCode | null;
  branch?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  return (
    <Alert variant="destructive" data-notice="failed" data-error-code={errorCode ?? "UNKNOWN"}>
      <XCircleIcon aria-hidden="true" />
      <AlertTitle>Analysis failed</AlertTitle>
      <AlertDescription>
        <p>{failedMessage(errorCode, branch)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {errorCode === "GITHUB_ACCESS_LOST" ? <a href="/api/github/authorize">Reconnect GitHub</a> : null}
          {errorCode === "BRANCH_NOT_FOUND" ? <Link href="/dashboard">Back to dashboard</Link> : null}
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retryDisabled}>
              <RefreshCwIcon aria-hidden="true" />
              Retry analysis
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
