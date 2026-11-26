import type {
  AnalysisStatus,
  FindingCategory,
  JobErrorCode,
  Severity,
  SignalKind,
  TriggerKind,
} from "@/features/analysis/schemas";

/**
 * User-facing copy for the analysis UI. Strings marked "exact" are fixed by
 * docs/design.md; change them only with the architect.
 */
export const COPY = {
  /** exact (design.md, done + AI_DISABLED) */
  aiDisabled:
    "AI analysis is not enabled yet. Security findings and detected signals are shown above. Recommendations will appear here once AI analysis is turned on.",
  /** exact (design.md, DAILY_CAP_REACHED for analyses) */
  dailyCapAnalyses: "Daily limit reached (10 analyses per day). It resets at 00:00 UTC.",
  /** exact (design.md, RATE_LIMITED) */
  rateLimited: "Too many requests, try again in a minute",
  /** exact (design.md, project installation_id = null) */
  reconnect: "Reconnect GitHub to analyze",
  /** exact (design.md, Phase 1.2 D-45, sentence after the reconnect notice) */
  reconnectOtherAccount:
    "If this repository is on someone else's personal GitHub account, Flow Motion can no longer analyze it. Its past results stay here until you delete the project.",
  /** exact (design.md, Phase 1.2, dashboard project card with installation_id = null) */
  notConnected: "Not connected to GitHub",
  /** exact (design.md, project stale = true) */
  stale: "New commits since the last analysis",
  /** exact (design.md, files summary explanation) */
  filesExplanation:
    'Flow Motion never opens files that might hold secrets. Some ordinary files with names like "secret" or "credentials" are skipped too.',
  /** exact (design.md, empty states) */
  noFindings: "No secrets found in the files we read.",
  noSignals: "No automation signals found.",
  noRecommendations: "No automations found",
  notAnalyzed: "Not analyzed yet",
} as const;

/** exact (design.md): message per failed-analysis error code. */
export function failedMessage(code: JobErrorCode | null, branch?: string): string {
  switch (code) {
    case "JOB_EXPIRED":
      return "This analysis stopped making progress and was cancelled. Try again.";
    case "BRANCH_NOT_FOUND":
      return `The branch ${branch ?? ""} no longer exists on GitHub. Add the repository again and choose another branch.`;
    case "GITHUB_ACCESS_LOST":
      return "Flow Motion can no longer read this repository. Reconnect GitHub and try again.";
    case "MODEL_OUTPUT_INVALID":
      return "The AI returned an answer we could not use. Your security findings are saved below. Try analyzing again.";
    case "AI_UNAVAILABLE":
      // D-35: never names the provider.
      return "The AI service did not respond. Your security findings and detected signals are saved below. Try again later.";
    default:
      return "Something went wrong during analysis. Try again.";
  }
}

/** Labels for the active statuses are exact (design.md); terminal ones are ours. */
export const STATUS_LABEL: Readonly<Record<AnalysisStatus, string>> = {
  queued: "Queued",
  validating: "Checking project",
  scanning: "Scanning files",
  analyzing: "Analyzing",
  done: "Done",
  failed: "Failed",
  rejected: "Not a website or app",
};

/** The four active steps in order, for the progress stepper. */
export const ACTIVE_STEPS = ["queued", "validating", "scanning", "analyzing"] as const;

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** exact (design.md, recommendation risk badge, D-36) */
export const RISK_LABEL: Readonly<Record<Severity, string>> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
};

/**
 * exact (design.md, Phase 2d count line under "Recommendations"):
 * "N recommendations found" for N >= 2, "1 recommendation found" for 1,
 * null (no line) for 0, where the empty state is shown instead.
 */
export function recommendationsFoundText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 recommendation found" : `${count} recommendations found`;
}

export const SEVERITY_ORDER: readonly Severity[] = ["high", "medium", "low"];

/** snake_case category turned into words (design.md), acronyms kept upper case. */
export const CATEGORY_LABEL: Readonly<Record<FindingCategory, string>> = {
  committed_env_file: "Committed env file",
  hardcoded_secret: "Hardcoded secret",
  private_key: "Private key",
  cloud_credentials: "Cloud credentials",
  service_account: "Service account",
  db_connection_string: "DB connection string",
  jwt_signing_secret: "JWT signing secret",
  webhook_secret_url: "Webhook secret URL",
  ci_secret: "CI secret",
  client_exposed_secret: "Client exposed secret",
  debug_config: "Debug config",
};

/** exact (design.md): signal group headings, in display order. */
export const SIGNAL_HEADING: Readonly<Record<SignalKind, string>> = {
  route: "Routes",
  webhook: "Webhooks",
  schedule: "Schedules",
  queue_consumer: "Queue consumers",
  messaging: "Messaging",
  db_write: "Database writes",
  ci_workflow: "CI workflows",
  env_var: "Environment variables",
};

/** exact (design.md): skipped-file reason labels, in display order. */
export const SKIPPED_LABEL = {
  denied: "Blocked for safety",
  extension: "Unsupported file type",
  size: "Too large (over 200 KB)",
  cap: "Over the 400-file limit",
  budget: "Not sent to AI (size budget)",
} as const;

export const TRIGGER_LABEL: Readonly<Record<TriggerKind, string>> = {
  webhook: "Webhook",
  schedule: "Schedule",
  manual: "Manual",
};

/** Short commit SHA for display. */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown commit";
}

/** `filePath:line`, or the path alone when line is null (design.md). */
export function fileLocation(filePath: string, line: number | null): string {
  return line === null ? filePath : `${filePath}:${line}`;
}
