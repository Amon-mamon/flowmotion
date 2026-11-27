import { describe, expect, it } from "vitest";

import {
  FLOW_COPY,
  compatibleText,
  credentialText,
  downloadErrorText,
  flowFailedMessage,
  importNotVerifiedText,
  majorMinor,
  usedByText,
} from "@/features/flows/copy";
import type { JobErrorCode } from "@/features/flows/schemas";

describe("flow copy (design.md exact strings)", () => {
  it("fixed strings", () => {
    expect(FLOW_COPY).toMatchObject({
      backToAnalysis: "Back to analysis",
      validBadge: "Valid",
      validSentence: "Passed Flow Motion's structure checks. It has not been tested with mock data yet.",
      generating: "Generating your flow. This usually takes less than two minutes.",
      triggerTag: "Trigger",
      noParameters: "No parameters",
      noCredential: "No credential needed",
      noSourceFiles: "None",
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
      generate: "Generate flow",
      generatePending: "Starting…",
      lastAttemptFailed: "The last attempt did not produce a flow.",
      viewDetails: "View details",
      tryAgain: "Try again",
      generatingBadge: "Generating",
      viewProgress: "View progress",
      flowReady: "Flow ready",
      openFlow: "Open flow",
      generateNotReady: "Flow generation is being set up.",
      generateHelper: "Each flow is generated on its own. You can generate up to 30 flows per day.",
      generateFailed: "Could not start generation. Try again.",
      dailyCapGenerations: "Daily limit reached (30 flows per day). It resets at 00:00 UTC.",
      rateLimited: "Too many requests, try again in a minute",
      staleTitle: "This analysis is out of date",
      staleBody: "New commits were pushed after this analysis. The flow would be built from the analyzed commit",
      generateAnyway: "Generate anyway",
      reanalyze: "Re-analyze",
      noFlows: "No flows yet",
      noFlowsDescription: "Generated flows will appear here once a project has been analyzed.",
      flowsLoadFailed: "Could not load flows",
      statusGenerating: "Generating",
      statusReady: "Ready",
      statusFailed: "Failed",
    });
  });

  it("never mentions a provider, a plan, credits, or a guarantee", () => {
    const all = [
      ...Object.values(FLOW_COPY),
      ...(["GENERATION_EXHAUSTED", "AI_UNAVAILABLE", "AI_DISABLED", "INTERNAL"] as const).map(flowFailedMessage),
    ].join(" ");
    expect(all).not.toMatch(/openrouter|anthropic|claude|gpt|credit|upgrade|plan\b|pricing|guarantee/i);
  });

  it("n8n version is shown as major.minor", () => {
    expect(majorMinor("1.74.3")).toBe("1.74");
    expect(majorMinor("2.0")).toBe("2.0");
    expect(majorMinor("latest")).toBeNull();
    expect(majorMinor(null)).toBeNull();
    expect(compatibleText("1.74.3")).toBe("Compatible with n8n 1.74");
    expect(compatibleText(null)).toBeNull();
    expect(importNotVerifiedText("1.74.3")).toBe("Import into n8n 1.74 not yet verified");
    expect(importNotVerifiedText(null)).toBe("Import into n8n not yet verified");
  });

  it("failed messages per error code", () => {
    expect(flowFailedMessage("GENERATION_EXHAUSTED")).toBe("Could not generate a valid flow after 3 attempts.");
    expect(flowFailedMessage("AI_UNAVAILABLE")).toBe("The AI service did not respond. Try again later.");
    expect(flowFailedMessage("AI_DISABLED")).toBe("AI generation is not enabled yet.");
    expect(flowFailedMessage("GITHUB_ACCESS_LOST")).toBe(
      "Flow Motion can no longer read this repository. Reconnect GitHub and try again.",
    );
    expect(flowFailedMessage("JOB_EXPIRED")).toBe("Generation stopped making progress and was cancelled. Try again.");
    const generic = "Something went wrong while generating this flow. Try again.";
    expect(flowFailedMessage("INTERNAL")).toBe(generic);
    expect(flowFailedMessage(null)).toBe(generic);
    expect(flowFailedMessage("SOMETHING_NEW" as unknown as JobErrorCode)).toBe(generic);
  });

  it("credential, used-by, and download error texts", () => {
    expect(credentialText("Slack")).toBe("Needs a Slack credential in n8n");
    expect(credentialText(null)).toBe("No credential needed");
    expect(usedByText(["Notify team", "Log order"])).toBe("used by Notify team, Log order");
    expect(usedByText([])).toBeNull();
    expect(downloadErrorText("EXPORT_NOT_VALID")).toBe(
      "This flow cannot be exported. Generate it again from the recommendation.",
    );
    expect(downloadErrorText("RATE_LIMITED")).toBe("Too many requests, try again in a minute");
    expect(downloadErrorText("INTERNAL")).toBe("Could not download the file. Try again.");
    expect(downloadErrorText(null)).toBe("Could not download the file. Try again.");
  });
});
