import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const notFound = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => notFound(),
}));

import { AnalysisView } from "@/features/analysis/components/analysis-view";
import { COPY } from "@/features/analysis/copy";
import {
  accessLostAnalysis,
  aiDisabledAnalysis,
  analyzingAnalysis,
  branchNotFoundAnalysis,
  doneAnalysis,
  findingsFor,
  fixtureProjectId,
  internalFailedAnalysis,
  INVALID_REASONS,
  modelInvalidAnalysis,
  recommendationsFor,
  rejectedAnalyses,
  scanningAnalysis,
} from "@/features/analysis/fixtures";
import type { Analysis, Finding, Recommendation } from "@/features/analysis/schemas";
import { validProject } from "@/features/projects/fixtures";
import type { ProjectDetail } from "@/features/projects/schemas";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  notFound.mockReset();
});

const baseProject: ProjectDetail = { ...validProject, stale: false, analyses: [] };

function serve(
  analysis: Analysis,
  opts: {
    project?: ProjectDetail;
    findings?: Finding[];
    recommendations?: Recommendation[];
    analyze?: () => { status?: number; body: unknown };
  } = {},
) {
  const project = opts.project ?? baseProject;
  return mockFetch([
    { match: (u) => u === `/api/analyses/${analysis.id}`, respond: () => ok(analysis) },
    { match: (u) => u === `/api/projects/${project.id}`, respond: () => ok(project) },
    {
      match: (u) => u === `/api/projects/${project.id}/findings?analysisId=${analysis.id}`,
      respond: () => ok({ analysisId: analysis.id, findings: opts.findings ?? findingsFor(analysis.id) }),
    },
    {
      match: (u) => u === `/api/projects/${project.id}/recommendations?analysisId=${analysis.id}`,
      respond: () =>
        ok({ analysisId: analysis.id, recommendations: opts.recommendations ?? recommendationsFor(analysis.id) }),
    },
    {
      method: "POST",
      match: (u) => u === `/api/projects/${project.id}/analyze`,
      respond: opts.analyze ?? (() => ok({ analysisId: doneAnalysis.id }, 202)),
    },
  ]);
}

function view(analysis: Analysis) {
  return renderWithQuery(<AnalysisView projectId={fixtureProjectId} analysisId={analysis.id} pollIntervalMs={60_000} />);
}

describe("AnalysisView: loading and errors", () => {
  it("shows a loading state", () => {
    mockFetch([{ match: () => true, respond: () => new Promise(() => {}) }]);
    view(doneAnalysis);
    expect(screen.getByRole("status", { name: "Loading analysis" })).toBeInTheDocument();
  });

  it("404 when the analysis belongs to another project", async () => {
    serve({ ...doneAnalysis, projectId: "0b6a2c1e-1111-4a1a-9c1a-0000000000ff" });
    view(doneAnalysis);
    await waitFor(() => expect(notFound).toHaveBeenCalled());
    expect(screen.queryByText("Security findings")).not.toBeInTheDocument();
  });

  it("404 when the API says NOT_FOUND", async () => {
    mockFetch([{ match: () => true, respond: () => fail("NOT_FOUND", "x", 404) }]);
    view(doneAnalysis);
    await waitFor(() => expect(notFound).toHaveBeenCalled());
  });

  it("error state with retry on a server error", async () => {
    mockFetch([{ match: () => true, respond: () => fail("INTERNAL", "x", 500) }]);
    view(doneAnalysis);
    expect(await screen.findByText("Could not load analysis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("AnalysisView: active", () => {
  it("shows the progress bar with step labels and no results", async () => {
    serve(scanningAnalysis);
    view(scanningAnalysis);
    const bar = await screen.findByRole("progressbar", { name: "Analysis progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "35");
    const steps = within(screen.getByRole("list", { name: "Analysis steps" }));
    for (const label of ["Queued", "Checking project", "Scanning files", "Analyzing"]) {
      expect(steps.getByText(label)).toBeInTheDocument();
    }
    expect(steps.getByText("Scanning files").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.queryByText("Security findings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate/ })).not.toBeInTheDocument();
  });

  it("analyzing: shows the validation result while polling", async () => {
    serve(analyzingAnalysis);
    view(analyzingAnalysis);
    expect(await screen.findByText("Recognized as a website project.")).toBeInTheDocument();
  });
});

describe("AnalysisView: rejected (invalid project stops)", () => {
  it.each(INVALID_REASONS.map((reason, i) => [reason, rejectedAnalyses[i]!] as const))(
    "shows the reason as plain text: %s",
    async (reason, analysis) => {
      serve(analysis);
      view(analysis);
      expect(await screen.findByText(reason)).toBeInTheDocument();
      expect(screen.getByText("This repository was not recognized as a website or app")).toBeInTheDocument();
      expect(screen.queryByText("Security findings")).not.toBeInTheDocument();
      expect(screen.queryByText("Recommendations")).not.toBeInTheDocument();
      expect(screen.queryByText("Files")).not.toBeInTheDocument();
    },
  );

  it("renders an HTML-looking reason as literal text", async () => {
    const analysis = { ...rejectedAnalyses[0]!, validation: { kind: "invalid" as const, reason: "<img src=x onerror=alert(1)>" } };
    serve(analysis);
    view(analysis);
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("AnalysisView: done", () => {
  it("files summary, findings by severity, signals by kind, recommendations", async () => {
    serve(doneAnalysis);
    view(doneAnalysis);

    expect(await screen.findByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByTestId("files-read")).toHaveTextContent("120");
    expect(screen.getByTestId("files-skipped")).toHaveTextContent("67");
    expect(screen.getByText(COPY.filesExplanation)).toBeInTheDocument();

    // Findings grouped by severity, high first.
    await screen.findAllByTestId("masked-evidence");
    const groups = document.querySelectorAll("[data-severity-group]");
    expect([...groups].map((g) => g.getAttribute("data-severity-group"))).toEqual(["high", "medium", "low"]);
    expect(screen.getByText(".env.production")).toBeInTheDocument();
    expect(screen.getByText("src/lib/payments.ts:7")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();

    // Signals grouped by kind with design.md headings.
    expect(screen.getByRole("heading", { name: /^Routes/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Environment variables/ })).toBeInTheDocument();
    expect(screen.getByText("POST /api/orders")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Queue consumers/ })).not.toBeInTheDocument();

    expect(await screen.findByText("Notify Slack on new orders")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate/ })).toBeDisabled();
    expect(screen.queryByText(COPY.aiDisabled)).not.toBeInTheDocument();
  });

  it("empty findings, signals, and recommendations use the design.md empty states", async () => {
    const analysis = { ...doneAnalysis, signals: [] };
    serve(analysis, { findings: [], recommendations: [] });
    view(analysis);
    expect(await screen.findByText(COPY.noFindings)).toBeInTheDocument();
    expect(screen.getByText(COPY.noSignals)).toBeInTheDocument();
    expect(await screen.findByText(COPY.noRecommendations)).toBeInTheDocument();
  });

  it("findings error state", async () => {
    mockFetch([
      { match: (u) => u === `/api/analyses/${doneAnalysis.id}`, respond: () => ok(doneAnalysis) },
      { match: (u) => u === `/api/projects/${fixtureProjectId}`, respond: () => ok(baseProject) },
      { match: (u) => u.includes("/findings"), respond: () => fail("INTERNAL", "x", 500) },
      { match: (u) => u.includes("/recommendations"), respond: () => ok({ analysisId: null, recommendations: [] }) },
    ]);
    view(doneAnalysis);
    expect(await screen.findByText("Could not load findings")).toBeInTheDocument();
  });

  it("AI_DISABLED: exact notice in place of recommendations, no button, no recommendations request", async () => {
    const fetchMock = serve(aiDisabledAnalysis);
    view(aiDisabledAnalysis);
    const notice = await screen.findByText(COPY.aiDisabled);
    expect(notice.textContent).toBe(
      "AI analysis is not enabled yet. Security findings and detected signals are shown above. Recommendations will appear here once AI analysis is turned on.",
    );
    expect(notice.closest("[data-notice]")?.querySelector("button")).toBeNull();
    expect(notice.closest("[role=alert]")).toBeNull();
    // Findings and signals still shown.
    expect(await screen.findAllByTestId("masked-evidence")).toHaveLength(4);
    expect(screen.getByText("nodemailer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/recommendations"))).toBe(false);
  });

  it("stale: notice with Re-analyze when the project moved past this commit", async () => {
    serve(doneAnalysis, {
      project: { ...baseProject, stale: true, lastCommitSha: "ffffffffffffffffffffffffffffffffffffffff" },
    });
    view(doneAnalysis);
    expect(await screen.findByText(COPY.stale)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/projects/${fixtureProjectId}/analysis/${doneAnalysis.id}`),
    );
  });

  it("DAILY_CAP_REACHED on Analyze again shows the plain cap notice, never a plan prompt", async () => {
    serve(doneAnalysis, {
      analyze: () => fail("DAILY_CAP_REACHED", "Daily limit of 10 analyses reached. It resets at 00:00 UTC.", 429),
    });
    view(doneAnalysis);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze again" }));
    expect(
      await screen.findByText("Daily limit reached (10 analyses per day). It resets at 00:00 UTC."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/upgrade|plan|pricing/i)).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("AnalysisView: failed", () => {
  it("MODEL_OUTPUT_INVALID: exact message, Retry, findings and signals still shown", async () => {
    serve(modelInvalidAnalysis);
    view(modelInvalidAnalysis);
    expect(
      await screen.findByText(
        "The AI returned an answer we could not use. Your security findings are saved below. Try analyzing again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry analysis" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("masked-evidence")).toHaveLength(4);
    expect(screen.getByText("nodemailer")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recommendations" })).not.toBeInTheDocument();
  });

  it("GITHUB_ACCESS_LOST: exact message with a reconnect link", async () => {
    serve(accessLostAnalysis);
    view(accessLostAnalysis);
    expect(
      await screen.findByText("Flow Motion can no longer read this repository. Reconnect GitHub and try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", "/api/github/install");
    expect(screen.queryByText("Security findings")).not.toBeInTheDocument();
  });

  it("INTERNAL: generic message; Retry starts a new analysis", async () => {
    serve(internalFailedAnalysis);
    view(internalFailedAnalysis);
    expect(await screen.findByText("Something went wrong during analysis. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("INTERNAL after detect (ai step failed, zero signals): saved findings are still shown (R2-4)", async () => {
    const aiFailed: Analysis = { ...internalFailedAnalysis, progress: 75, signals: [] };
    serve(aiFailed);
    view(aiFailed);
    expect(await screen.findByText("Something went wrong during analysis. Try again.")).toBeInTheDocument();
    expect(await screen.findAllByTestId("masked-evidence")).toHaveLength(4);
    expect(screen.queryByRole("heading", { name: "Recommendations" })).not.toBeInTheDocument();
  });

  it("JOB_EXPIRED (D-29): exact message, Retry starts a new analysis", async () => {
    const expired: Analysis = { ...internalFailedAnalysis, errorCode: "JOB_EXPIRED" };
    serve(expired);
    view(expired);
    expect(
      await screen.findByText("This analysis stopped making progress and was cancelled. Try again."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry analysis" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("INTERNAL before detect: no results block", async () => {
    serve(internalFailedAnalysis);
    view(internalFailedAnalysis);
    expect(await screen.findByText("Something went wrong during analysis. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Security findings")).not.toBeInTheDocument();
  });

  it("reconnect notice and disabled Retry when the installation is gone", async () => {
    serve(accessLostAnalysis, { project: { ...baseProject, installationId: null } });
    view(accessLostAnalysis);
    expect(await screen.findByText(COPY.reconnect)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry analysis" })).toBeDisabled());
  });
});

describe("AnalysisView: branch (Phase 1.1)", () => {
  it("header shows Branch <branch> at <short sha>", async () => {
    serve(doneAnalysis);
    view(doneAnalysis);
    expect(await screen.findByTestId("analysis-branch-line")).toHaveTextContent("Branch release/2026-11 at a1b2c3d");
  });

  it("omits the SHA while it is null", async () => {
    serve(branchNotFoundAnalysis);
    view(branchNotFoundAnalysis);
    const line = await screen.findByTestId("analysis-branch-line");
    expect(line).toHaveTextContent("Branch release/2026-11");
    expect(line).not.toHaveTextContent(" at ");
  });

  it("BRANCH_NOT_FOUND: exact message, no Retry, link back to the dashboard", async () => {
    serve(branchNotFoundAnalysis);
    view(branchNotFoundAnalysis);
    expect(
      await screen.findByText(
        "The branch release/2026-11 no longer exists on GitHub. Add the repository again and choose another branch.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry analysis" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});
