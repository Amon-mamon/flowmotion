import { RefreshCwIcon } from "lucide-react";

import { ApiError } from "@/features/api/client";

/** exact (design.md "Refresh repository access", D-22) */
export const REFRESH_NOTICE =
  "Flow Motion needs to re-check which repositories you can access on GitHub. This happens at least once a day.";
export const REFRESH_ACTION = "Refresh repository access";
export const REFRESH_HREF = "/api/github/authorize";

/** True when a repo-scoped call says the user's repo access set must be refreshed. */
export function isRefreshRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === "GITHUB_REFRESH_REQUIRED";
}

/** "Refresh repository access": a plain anchor (the route redirects to GitHub, never prefetched). */
export function RefreshAccessLink({ className }: { className?: string }) {
  return (
    <a href={REFRESH_HREF} className={className ?? "text-primary underline-offset-4 hover:underline"}>
      {REFRESH_ACTION}
    </a>
  );
}

/** Plain notice shown whenever an API call returns GITHUB_REFRESH_REQUIRED (no error styling). */
export function RefreshAccessNotice() {
  return (
    <div
      role="status"
      data-notice="refresh-access"
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm"
    >
      <RefreshCwIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p>{REFRESH_NOTICE}</p>
        <RefreshAccessLink />
      </div>
    </div>
  );
}
