import type { JobErrorCode } from "@/features/flows/schemas";

/**
 * User-facing copy for the flow UI. Every string here is fixed by
 * docs/design.md ("Flow page", "Card action area"); change them only with the
 * architect. Nothing names the AI provider, a plan, or credits.
 */
export const FLOW_COPY = {
  backToAnalysis: "Back to analysis",
  /** Level badge and its sentence (testing.md: Phase 3 produces "Valid" only). */
  validBadge: "Valid",
  validSentence: "Passed Flow Motion's structure checks. It has not been tested with mock data yet.",
  generating: "Generating your flow. This usually takes less than two minutes.",

  // Canvas
  triggerTag: "Trigger",

  // Node inspector
  typeRow: "Type",
  parametersRow: "Parameters",
  noParameters: "No parameters",
  credentialRow: "Credential",
  noCredential: "No credential needed",
  sourceFilesRow: "Source files",
  noSourceFiles: "None",
  notesRow: "Notes",

  // Export panel
  exportHeading: "Export to n8n",
  exportSubheading: "Before you run it in n8n",
  credentialsHeading: "Credentials to connect",
  noCredentials: "No credentials needed.",
  placeholdersHeading: "Values to replace",
  noPlaceholders: "Nothing to replace.",
  warningsHeading: "Check before activating",
  download: "Download n8n JSON",
  downloadPending: "Preparing…",
  exportHelper: "In n8n, choose Import from File and select this file. Flow Motion does not run flows for you.",
  exportNotValid: "This flow cannot be exported. Generate it again from the recommendation.",
  downloadFailed: "Could not download the file. Try again.",
  /** exact (design.md, RATE_LIMITED shared copy) */
  rateLimited: "Too many requests, try again in a minute",

  // Recommendation card action area (D-42)
  generate: "Generate flow",
  generatePending: "Starting…",
  lastAttemptFailed: "The last attempt did not produce a flow.",
  viewDetails: "View details",
  tryAgain: "Try again",
  generatingBadge: "Generating",
  viewProgress: "View progress",
  flowReady: "Flow ready",
  openFlow: "Open flow",
  /** Phase 3a only, while the Generate API is not ready. */
  generateNotReady: "Flow generation is being set up.",
  generateHelper: "Each flow is generated on its own. You can generate up to 30 flows per day.",
  generateFailed: "Could not start generation. Try again.",
} as const;

/** "1.74.3" → "1.74"; null when the version is missing or not numeric. */
export function majorMinor(version: string | null): string | null {
  if (version === null) return null;
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

/** exact (design.md): "Compatible with n8n <major.minor>"; null without a version. */
export function compatibleText(n8nVersion: string | null): string | null {
  const version = majorMinor(n8nVersion);
  return version === null ? null : `Compatible with n8n ${version}`;
}

/** exact (design.md): "Import into n8n <major.minor> not yet verified". */
export function importNotVerifiedText(n8nVersion: string | null): string {
  const version = majorMinor(n8nVersion);
  // The version is always set on a ready flow; without one the notice drops it (contract is silent).
  return version === null ? "Import into n8n not yet verified" : `Import into n8n ${version} not yet verified`;
}

/** exact (design.md): message per failed-flow error code. Never names the AI provider. */
export function flowFailedMessage(code: JobErrorCode | null): string {
  switch (code) {
    case "GENERATION_EXHAUSTED":
      return "Could not generate a valid flow after 3 attempts.";
    case "AI_UNAVAILABLE":
      return "The AI service did not respond. Try again later.";
    case "AI_DISABLED":
      return "AI generation is not enabled yet.";
    case "GITHUB_ACCESS_LOST":
      return "Flow Motion can no longer read this repository. Reconnect GitHub and try again.";
    case "JOB_EXPIRED":
      return "Generation stopped making progress and was cancelled. Try again.";
    default:
      return "Something went wrong while generating this flow. Try again.";
  }
}

/** exact (design.md): "Needs a <name> credential in n8n" or "No credential needed". */
export function credentialText(credential: string | null): string {
  return credential === null ? FLOW_COPY.noCredential : `Needs a ${credential} credential in n8n`;
}

/** exact (design.md): "used by <node labels>"; null when the list is empty. */
export function usedByText(labels: readonly string[]): string | null {
  return labels.length === 0 ? null : `used by ${labels.join(", ")}`;
}

/** exact (design.md): download error by API code. */
export function downloadErrorText(code: string | null): string {
  if (code === "EXPORT_NOT_VALID") return FLOW_COPY.exportNotValid;
  if (code === "RATE_LIMITED") return FLOW_COPY.rateLimited;
  return FLOW_COPY.downloadFailed;
}
