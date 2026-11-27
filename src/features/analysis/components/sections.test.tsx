import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ApiError } from "@/features/api/client";
import {
  AiDisabledNotice,
  FailedNotice,
  ReconnectNotice,
  StaleNotice,
} from "@/features/analysis/components/analysis-notices";
import { AnalyzeErrorNotice } from "@/features/analysis/components/analyze-error-notice";
import { FilesSummary, totalSkipped } from "@/features/analysis/components/files-summary";
import { FindingsList } from "@/features/analysis/components/findings-list";
import { RecommendationsList } from "@/features/analysis/components/recommendations-list";
import { RiskBadge } from "@/features/analysis/components/risk-badge";
import { SeverityBadge } from "@/features/analysis/components/severity-badge";
import { SignalsList } from "@/features/analysis/components/signals-list";
import { COPY, SKIPPED_LABEL } from "@/features/analysis/copy";
import {
  doneAnalysis,
  doneFindings,
  doneRecommendations,
  fullCounts,
  zeroCounts,
} from "@/features/analysis/fixtures";
import type { Finding } from "@/features/analysis/schemas";
import { renderWithQuery } from "@/features/test-utils/render";

const reasonRow = (key: string) => document.querySelector(`[data-reason="${key}"]`) as HTMLElement | null;

describe("FilesSummary", () => {
  it("groups skipped files by reason with the design.md labels and sums them", () => {
    render(<FilesSummary counts={fullCounts} />);
    expect(within(reasonRow("denied")!).getByText(SKIPPED_LABEL.denied)).toBeInTheDocument();
    expect(reasonRow("denied")).toHaveTextContent("Blocked for safety9");
    expect(reasonRow("extension")).toHaveTextContent("Unsupported file type31");
    expect(reasonRow("size")).toHaveTextContent("Too large (over 200 KB)2");
    expect(reasonRow("cap")).toHaveTextContent("Over the 400-file limit18");
    expect(reasonRow("budget")).toHaveTextContent("Not sent to AI (size budget)7");
    // 9 + 31 + 2 + 18 = filesBlocked (60), plus 7 for the budget.
    expect(fullCounts.filesBlocked).toBe(60);
    expect(totalSkipped(fullCounts)).toBe(67);
    expect(screen.getByTestId("files-skipped")).toHaveTextContent("67");
    expect(screen.getByTestId("files-read")).toHaveTextContent("120");
    expect(screen.getByText(COPY.filesExplanation)).toBeInTheDocument();
  });

  it("hides the budget row when 0 and still shows the other reasons at 0", () => {
    render(<FilesSummary counts={zeroCounts} />);
    expect(reasonRow("budget")).toBeNull();
    expect(screen.queryByText(SKIPPED_LABEL.budget)).not.toBeInTheDocument();
    for (const key of ["denied", "extension", "size", "cap"]) {
      expect(reasonRow(key)).toHaveTextContent("0");
    }
    expect(screen.getByTestId("files-skipped")).toHaveTextContent("0");
  });
});

describe("FindingsList", () => {
  it("renders masked evidence in mono with category, location, and remediation", () => {
    render(<FindingsList findings={doneFindings} />);
    const evidence = screen.getAllByTestId("masked-evidence");
    expect(evidence.map((e) => e.textContent)).toEqual([
      "file present (not opened)",
      "Stripe secret key: sk…9Q",
      "NEXT_PUBLIC_SERVICE_ROLE_KEY",
      "debug flag",
    ]);
    expect(evidence[0]).toHaveClass("font-mono");
    expect(screen.getByText("Committed env file")).toBeInTheDocument();
    expect(screen.getByText("Client exposed secret")).toBeInTheDocument();
    expect(screen.getByText("backend/settings.py:22")).toBeInTheDocument();
    expect(screen.getByText(".env.production")).toBeInTheDocument();
    expect(screen.getByText("Move the key to an environment variable and rotate it.")).toBeInTheDocument();
  });

  it("keeps HTML-looking text literal (never rendered as HTML)", () => {
    const evil: Finding = {
      ...doneFindings[1]!,
      filePath: "<script>alert(1)</script>.ts",
      maskedEvidence: "<b>xx…yy</b>",
      remediation: '<a href="javascript:alert(1)">click</a>',
    };
    render(<FindingsList findings={[evil]} />);
    expect(screen.getByTestId("masked-evidence").textContent).toBe("<b>xx…yy</b>");
    expect(screen.getByText("<script>alert(1)</script>.ts:7")).toBeInTheDocument();
    expect(screen.getByText('<a href="javascript:alert(1)">click</a>')).toBeInTheDocument();
    expect(document.querySelector("b, script, a")).toBeNull();
  });

  it("caps very long evidence as a second guard", () => {
    render(<FindingsList findings={[{ ...doneFindings[1]!, maskedEvidence: "x".repeat(500) }]} />);
    expect(screen.getByTestId("masked-evidence").textContent!.length).toBeLessThanOrEqual(121);
  });

  it("groups by severity, high first", () => {
    render(<FindingsList findings={[...doneFindings].reverse()} />);
    expect(screen.getByRole("heading", { name: "High severity (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Medium severity (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Low severity (1)" })).toBeInTheDocument();
    const groups = [...document.querySelectorAll("[data-severity-group]")].map((g) =>
      g.getAttribute("data-severity-group"),
    );
    expect(groups).toEqual(["high", "medium", "low"]);
  });

  it("empty state", () => {
    render(<FindingsList findings={[]} />);
    expect(screen.getByText("No secrets found in the files we read.")).toBeInTheDocument();
  });
});

describe("SeverityBadge", () => {
  it.each([
    ["high", "High"],
    ["medium", "Medium"],
    ["low", "Low"],
  ] as const)("%s shows an icon plus %s", (severity, label) => {
    const { container } = render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("SeverityBadge (findings): outlined red, unchanged by D-36", () => {
  it.each(["high", "medium", "low"] as const)("%s uses the red outline, no risk token", (severity) => {
    const { container } = render(<SeverityBadge severity={severity} />);
    const badge = container.querySelector(`[data-severity="${severity}"]`) as HTMLElement;
    expect(badge.className).toContain("border-primary");
    expect(badge.className).toContain("text-primary");
    expect(badge.className).toContain("bg-transparent");
    expect(badge.className).not.toMatch(/risk-/);
  });
});

describe("RiskBadge (D-36)", () => {
  it.each([
    ["low", "Low risk", "risk-low"],
    ["medium", "Medium risk", "risk-medium"],
    ["high", "High risk", "risk-high"],
  ] as const)("%s renders an icon, %s, and the %s token outline", (risk, label, token) => {
    const { container } = render(<RiskBadge risk={risk} />);
    const badge = container.querySelector(`[data-risk="${risk}"]`) as HTMLElement;
    expect(badge.textContent).toBe(label);
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.className).toContain(`border-${token}`);
    expect(badge.className).toContain(`text-${token}`);
    expect(badge.className).toContain("bg-transparent");
    expect(badge.className).toContain("rounded-lg");
    // The outline variant's neutral border/text are overridden by the token.
    expect(badge.className).not.toContain("border-border");
    expect(badge.className).not.toContain("text-foreground");
  });

  it("Low risk is not the red token", () => {
    const { container } = render(<RiskBadge risk="low" />);
    const badge = container.querySelector("[data-risk=low]") as HTMLElement;
    const classes = badge.className.split(/\s+/);
    for (const red of ["border-risk-high", "text-risk-high", "border-primary", "text-primary", "border-destructive", "text-destructive"]) {
      expect(classes).not.toContain(red);
    }
  });
});

describe("SignalsList", () => {
  it("keeps HTML-looking labels literal", () => {
    render(<SignalsList signals={[{ kind: "route", filePath: "a.ts", line: 1, label: "<i>GET /x</i>" }]} />);
    expect(screen.getByText("<i>GET /x</i>")).toBeInTheDocument();
    expect(document.querySelector("i")).toBeNull();
    expect(screen.getByText("a.ts:1")).toBeInTheDocument();
  });

  it("shows the design.md heading for every kind present", () => {
    render(<SignalsList signals={doneAnalysis.signals} />);
    for (const heading of [
      "Routes",
      "Webhooks",
      "Schedules",
      "Messaging",
      "Database writes",
      "CI workflows",
      "Environment variables",
    ]) {
      expect(screen.getByRole("heading", { name: new RegExp(`^${heading}`) })).toBeInTheDocument();
    }
    expect(screen.getByText("vercel.json")).toBeInTheDocument();
  });
});

const listProps = { projectId: "project-1", analysisCommitSha: null };

describe("RecommendationsList", () => {
  it("shows title, trigger, confidence, credentials, risk, source files, rationale", () => {
    renderWithQuery(<RecommendationsList recommendations={doneRecommendations} {...listProps} />);
    const card = document.querySelector(`[data-recommendation="${doneRecommendations[1]!.id}"]`) as HTMLElement;
    const c = within(card);
    expect(c.getByText("Nightly order summary email")).toBeInTheDocument();
    expect(c.getByText("Schedule")).toBeInTheDocument();
    expect(c.getByText("74% confidence")).toBeInTheDocument();
    expect(c.getByText("SMTP")).toBeInTheDocument();
    expect(c.getByText("Postgres")).toBeInTheDocument();
    expect(c.getByText("Medium risk")).toBeInTheDocument();
    // Recommendation cards use the RiskBadge, never the finding severity badge (D-36).
    expect(card.querySelector("[data-risk=medium]")).not.toBeNull();
    expect(card.querySelector("[data-severity]")).toBeNull();
    expect(c.queryByText(/Risk:/)).toBeNull();
    expect(c.getByText("src/server/orders.ts")).toBeInTheDocument();
    expect(c.getByText(/A cron entry in vercel.json/)).toBeInTheDocument();
  });

  it("has no checkbox or selected bar; each card has its own gated Generate flow button (D-42)", () => {
    renderWithQuery(<RecommendationsList recommendations={doneRecommendations} {...listProps} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selected-count")).not.toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Generate flow" });
    expect(buttons).toHaveLength(doneRecommendations.length);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription("Flow generation is being set up.");
    }
  });

  it("selected shows Generating with View progress; generated links to the flow", () => {
    const flowId = "7d1e2f3a-6666-4f6f-8a6f-000000000001";
    renderWithQuery(
      <RecommendationsList
        recommendations={[
          { ...doneRecommendations[0]!, status: "selected", flowId },
          { ...doneRecommendations[1]!, status: "generated", flowId },
        ]}
        {...listProps}
      />,
    );
    expect(screen.getByText("Generating")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute("href", `/flows/${flowId}`);
    expect(screen.getByText("Flow ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open flow" })).toHaveAttribute("href", `/flows/${flowId}`);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps model text literal", () => {
    renderWithQuery(
      <RecommendationsList
        recommendations={[{ ...doneRecommendations[0]!, title: "<h1>Pwn</h1>", rationale: "<em>x</em> because" }]}
        {...listProps}
      />,
    );
    expect(screen.getByText("<h1>Pwn</h1>")).toBeInTheDocument();
    expect(screen.getByText("<em>x</em> because")).toBeInTheDocument();
    expect(document.querySelector("h1, em")).toBeNull();
  });

  it("empty state", () => {
    renderWithQuery(<RecommendationsList recommendations={[]} {...listProps} />);
    expect(screen.getByText("No automations found")).toBeInTheDocument();
  });
});

describe("Notices (exact design.md copy)", () => {
  it("AI disabled: plain notice, no button", () => {
    render(<AiDisabledNotice />);
    expect(
      screen.getByText(
        "AI analysis is not enabled yet. Security findings and detected signals are shown above. Recommendations will appear here once AI analysis is turned on.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reconnect", () => {
    render(<ReconnectNotice />);
    expect(screen.getByText("Reconnect GitHub to analyze")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", "/api/github/authorize");
    expect(
      screen.getByText(
        "If this repository is on someone else's personal GitHub account, Flow Motion can no longer analyze it. Its past results stay here until you delete the project.",
      ),
    ).toBeInTheDocument();
  });

  it("stale", () => {
    render(<StaleNotice />);
    expect(screen.getByText("New commits since the last analysis")).toBeInTheDocument();
  });

  it.each([
    ["GITHUB_ACCESS_LOST", "Flow Motion can no longer read this repository. Reconnect GitHub and try again."],
    [
      "MODEL_OUTPUT_INVALID",
      "The AI returned an answer we could not use. Your security findings are saved below. Try analyzing again.",
    ],
    [
      "AI_UNAVAILABLE",
      "The AI service did not respond. Your security findings and detected signals are saved below. Try again later.",
    ],
    ["INTERNAL", "Something went wrong during analysis. Try again."],
    [null, "Something went wrong during analysis. Try again."],
  ] as const)("failed %s", (code, text) => {
    render(<FailedNotice errorCode={code} onRetry={() => {}} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry analysis" })).toBeInTheDocument();
  });

  it.each([
    ["DAILY_CAP_REACHED", 429, "Daily limit reached (10 analyses per day). It resets at 00:00 UTC."],
    ["RATE_LIMITED", 429, "Too many requests, try again in a minute"],
    ["INTERNAL", 500, "Something went wrong. Try again."],
  ] as const)("analyze error %s", (code, status, text) => {
    render(<AnalyzeErrorNotice error={new ApiError(code, "server text", status)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("server text")).toBeNull();
    expect(screen.queryByText(/upgrade|plan|pricing|credits/i)).toBeNull();
  });

  it("analyze VALIDATION_ERROR shows the server message as plain text", () => {
    render(<AnalyzeErrorNotice error={new ApiError("VALIDATION_ERROR", "<b>An analysis is already running</b>", 400)} />);
    expect(screen.getByText("<b>An analysis is already running</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("AnalyzeErrorNotice GITHUB_REFRESH_REQUIRED (D-22)", () => {
  it("shows the refresh notice with the link", () => {
    render(<AnalyzeErrorNotice error={new ApiError("GITHUB_REFRESH_REQUIRED", "x", 403)} />);
    expect(
      screen.getByText(
        "Flow Motion needs to re-check which repositories you can access on GitHub. This happens at least once a day.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Refresh repository access" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
  });
});
