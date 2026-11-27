import { AlertCircleIcon, ClockIcon } from "lucide-react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/features/api/client";
import { RefreshAccessNotice } from "@/features/github/components/refresh-access-notice";
import { FLOW_COPY } from "@/features/flows/copy";

/**
 * Plain notice inside a recommendation card for a failed
 * `POST /api/recommendations/generate` (design.md "Card action area").
 * Server messages render as plain text. PROJECT_STALE_ANALYSIS opens the
 * stale-analysis dialog instead, so it shows no notice here.
 */
export function GenerateErrorNotice({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : "UNKNOWN";

  if (code === "PROJECT_STALE_ANALYSIS") return null;
  if (code === "GITHUB_REFRESH_REQUIRED") return <RefreshAccessNotice />;
  if (code === "VALIDATION_ERROR" && error instanceof ApiError && error.message) {
    return (
      <Alert data-notice="generate-validation">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>{error.message}</AlertTitle>
      </Alert>
    );
  }
  if (code === "DAILY_CAP_REACHED") {
    return (
      <Alert data-notice="generate-daily-cap">
        <ClockIcon aria-hidden="true" />
        <AlertTitle>{FLOW_COPY.dailyCapGenerations}</AlertTitle>
      </Alert>
    );
  }
  if (code === "RATE_LIMITED") {
    return (
      <Alert data-notice="generate-rate-limited">
        <ClockIcon aria-hidden="true" />
        <AlertTitle>{FLOW_COPY.rateLimited}</AlertTitle>
      </Alert>
    );
  }
  return (
    <Alert data-notice="generate-error">
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>{FLOW_COPY.generateFailed}</AlertTitle>
    </Alert>
  );
}
