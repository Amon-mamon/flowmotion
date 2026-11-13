import { AlertCircleIcon, ClockIcon } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/features/api/client";
import { RefreshAccessNotice } from "@/features/github/components/refresh-access-notice";
import { COPY } from "@/features/analysis/copy";

/**
 * Notice for a failed `POST /api/projects/:id/analyze` (design.md mapping).
 * DAILY_CAP_REACHED is a plain notice with the reset time, never a plan or
 * upgrade prompt. Server messages are rendered as plain text.
 */
export function AnalyzeErrorNotice({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : "UNKNOWN";

  if (code === "GITHUB_REFRESH_REQUIRED") {
    return <RefreshAccessNotice />;
  }
  if (code === "DAILY_CAP_REACHED") {
    return (
      <Alert data-notice="daily-cap">
        <ClockIcon aria-hidden="true" />
        <AlertTitle>{COPY.dailyCapAnalyses}</AlertTitle>
      </Alert>
    );
  }
  if (code === "RATE_LIMITED") {
    return (
      <Alert data-notice="rate-limited">
        <ClockIcon aria-hidden="true" />
        <AlertTitle>{COPY.rateLimited}</AlertTitle>
      </Alert>
    );
  }
  if (code === "UNAUTHORIZED") {
    return (
      <Alert data-notice="unauthorized">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>Your session has expired.</AlertTitle>
        <AlertDescription>
          <Link href="/login">Sign in again</Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (code === "VALIDATION_ERROR" && error instanceof ApiError && error.message) {
    return (
      <Alert data-notice="validation">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>Could not start the analysis</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  if (code === "NETWORK" && error instanceof ApiError) {
    return (
      <Alert data-notice="network">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>Could not start the analysis</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert data-notice="error">
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>Could not start the analysis</AlertTitle>
      <AlertDescription>Something went wrong. Try again.</AlertDescription>
    </Alert>
  );
}
