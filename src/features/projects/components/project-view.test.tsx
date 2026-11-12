import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ProjectView } from "@/features/projects/components/project-view";
import { invalidProject, pendingProject, validProject } from "@/features/projects/fixtures";
import type { Project } from "@/features/projects/schemas";
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

  it("pending: header, Not analyzed yet badge, disabled Analyze with Phase 2 wording, empty sections", async () => {
    serve(pendingProject);
    renderWithQuery(<ProjectView projectId={pendingProject.id} />);
    expect(await screen.findByRole("heading", { level: 1, name: "acme/storefront" })).toBeInTheDocument();
    expect(screen.getByText("Not analyzed yet")).toBeInTheDocument();
    const analyze = screen.getByRole("button", { name: "Analyze" });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAccessibleDescription("Analysis arrives in Phase 2");
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
    expect(screen.getByText("No recommendations yet")).toBeInTheDocument();
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
    expect(screen.getByText("Reconnect GitHub to analyze")).toBeInTheDocument();
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
