import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ProjectView } from "@/features/projects/components/project-view";
import { invalidProject, pendingProject, validProject } from "@/features/projects/fixtures";
import type { Project, ProjectAnalysisSummary, ProjectDetail } from "@/features/projects/schemas";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

function serve(project: Project) {
  return mockFetch([
    { match: (u) => u === `/api/projects/${project.id}`, respond: () => ok({ ...project, analyses: [] }) },
    {
      method: "DELETE",
      match: (u) => u === `/api/projects/${project.id}`,
      respond: () => ok({ deleted: true }),
    },
  ]);
}

describe("ProjectView", () => {
  it("shows a loading state", () => {
    mockFetch([{ match: () => true, respond: () => new Promise(() => {}) }]);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    expect(screen.getByRole("status", { name: "Loading project" })).toBeInTheDocument();
  });

  it("pending: header, Not analyzed yet, enabled Analyze, no notices", async () => {
    serve(pendingProject);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    expect(await screen.findByRole("heading", { level: 1, name: "acme/storefront" })).toBeInTheDocument();
    expect(screen.getAllByText("Not analyzed yet").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByText("Reconnect GitHub to analyze")).not.toBeInTheDocument();
    expect(screen.queryByText("New commits since the last analysis")).not.toBeInTheDocument();
  });

  it("valid + stale: kind badge and stale notice", async () => {
    serve(validProject);
    renderWithQuery(<ProjectView projectId={validProject.id} />);
    expect(await screen.findByText("Valid · app")).toBeInTheDocument();
    expect(screen.getByText("New commits since the last analysis")).toBeInTheDocument();
  });

  it("invalid + no installation: reason as plain text and reconnect notice", async () => {
    serve({ ...invalidProject, invalidReason: "<b>docs only</b>" });
    renderWithQuery(<ProjectView projectId={invalidProject.id} />);
    expect(await screen.findByText("Invalid")).toBeInTheDocument();
    // Repo-derived text is rendered as text, never HTML.
    expect(screen.getByText("<b>docs only</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector('[data-notice="reconnect"]')).toHaveTextContent("Reconnect GitHub to analyze");
    expect(screen.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", "/api/github/install");
  });

  it("not found state", async () => {
    mockFetch([{ match: () => true, respond: () => fail("NOT_FOUND", "x", 404) }]);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("session expired: shows a Sign in again link", async () => {
    mockFetch([{ match: () => true, respond: () => fail("UNAUTHORIZED", "x", 401) }]);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("delete: confirm, DELETE, then navigate to /dashboard", async () => {
    const fetchMock = serve(pendingProject);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete project" }));
    expect(await screen.findByText("Delete acme/storefront?")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Delete project" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });
});

const analysisId = "5c1d8e2f-3333-4c3c-8e3c-000000000099";
const summary = (over: Partial<ProjectAnalysisSummary>): ProjectAnalysisSummary => ({
  id: analysisId,
  status: "done",
  commitSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  errorCode: null,
  startedAt: "2026-11-12T09:00:00.000Z",
  finishedAt: "2026-11-12T09:02:00.000Z",
  ...over,
});

function serveDetail(detail: ProjectDetail, analyze: () => { status?: number; body: unknown } = () => ok({ analysisId }, 202)) {
  return mockFetch([
    { match: (u) => u === `/api/projects/${detail.id}`, respond: () => ok(detail) },
    { method: "POST", match: (u) => u === `/api/projects/${detail.id}/analyze`, respond: analyze },
  ]);
}

describe("ProjectView: analyze (Phase 2)", () => {
  it("Analyze POSTs and navigates to the analysis page", async () => {
    const fetchMock = serveDetail({ ...pendingProject, analyses: [] });
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/projects/${pendingProject.id}/analysis/${analysisId}`),
    );
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => u === `/api/projects/${pendingProject.id}/analyze` && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("disabled with the reconnect hint when the installation is gone", async () => {
    serveDetail({ ...invalidProject, analyses: [] });
    renderWithQuery(<ProjectView projectId={invalidProject.id} />);
    const analyze = await screen.findByRole("button", { name: "Analyze" });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAccessibleDescription("Reconnect GitHub to analyze");
  });

  it("View progress replaces Analyze while an analysis is active", async () => {
    serveDetail({ ...validProject, analyses: [summary({ status: "scanning", finishedAt: null })] });
    renderWithQuery(<ProjectView projectId={validProject.id} />);
    const links = await screen.findAllByRole("link", { name: "View progress" });
    expect(links[0]).toHaveAttribute("href", `/projects/${validProject.id}/analysis/${analysisId}`);
    expect(screen.queryByRole("button", { name: "Analyze" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-analyze" })).not.toBeInTheDocument();
  });

  it("stale notice with Re-analyze starts a new analysis", async () => {
    serveDetail({ ...validProject, analyses: [summary({})] });
    renderWithQuery(<ProjectView projectId={validProject.id} />);
    expect(await screen.findByText("New commits since the last analysis")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("latest analysis and history: status label, short SHA, date, link", async () => {
    const older = "5c1d8e2f-3333-4c3c-8e3c-000000000098";
    serveDetail({
      ...validProject,
      analyses: [
        summary({ errorCode: "AI_DISABLED" }),
        summary({ id: older, status: "rejected", errorCode: "PROJECT_INVALID", commitSha: "ffffffffffffffffffff" }),
      ],
    });
    renderWithQuery(<ProjectView projectId={validProject.id} />);
    expect(await screen.findByRole("heading", { name: "Latest analysis" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View results" })).toHaveAttribute(
      "href",
      `/projects/${validProject.id}/analysis/${analysisId}`,
    );
    const history = screen.getByRole("heading", { name: "History" }).parentElement!;
    const items = history.querySelectorAll("li a");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Done");
    expect(items[0]).toHaveTextContent("a1b2c3d");
    expect(items[0]).toHaveTextContent("12 Nov 2026");
    expect(items[1]).toHaveTextContent("Not a website or app");
    expect(items[1]).toHaveAttribute("href", `/projects/${validProject.id}/analysis/${older}`);
  });

  it.each([
    ["DAILY_CAP_REACHED", 429, "Daily limit reached (10 analyses per day). It resets at 00:00 UTC."],
    ["RATE_LIMITED", 429, "Too many requests, try again in a minute"],
    ["VALIDATION_ERROR", 400, "An analysis is already running"],
  ] as const)("%s on Analyze shows its notice and stays on the page", async (code, status, text) => {
    serveDetail({ ...pendingProject, analyses: [] }, () => fail(code, "An analysis is already running", status));
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ProjectView: branch (Phase 1.1)", () => {
  it("header shows the chosen branch without the default badge when it differs", async () => {
    serve(validProject);
    renderWithQuery(<ProjectView projectId={validProject.id} />);
    expect(await screen.findByTestId("project-branch")).toHaveTextContent("release/2026-11");
    expect(screen.getByText("Branch")).toBeInTheDocument();
    expect(screen.queryByText("default")).not.toBeInTheDocument();
  });

  it("header shows the default badge when the branch is the default", async () => {
    serve(pendingProject);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    expect(await screen.findByTestId("project-branch")).toHaveTextContent("main");
    expect(screen.getByText("default")).toBeInTheDocument();
  });
});

describe("ProjectView: GITHUB_REFRESH_REQUIRED on Analyze (D-22)", () => {
  it("shows the refresh notice with the link", async () => {
    serveDetail({ ...pendingProject, analyses: [] }, () =>
      fail("GITHUB_REFRESH_REQUIRED", "Refresh repository access to continue.", 403),
    );
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));
    expect(
      await screen.findByText(
        "Flow Motion needs to re-check which repositories you can access on GitHub. This happens at least once a day.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Refresh repository access" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
