import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockParams,
}));
let mockParams = new URLSearchParams();

import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";
import { DashboardView } from "@/features/projects/components/dashboard-view";
import { ProjectStatusBadge } from "@/features/projects/components/project-status-badge";
import { projects } from "@/features/projects/fixtures";
import { render } from "@testing-library/react";

afterEach(() => {
  vi.unstubAllGlobals();
  mockParams = new URLSearchParams();
});

const isProjects = (u: string) => u === "/api/projects";

describe("Dashboard projects grid", () => {
  it("shows a loading state", () => {
    mockFetch([{ match: isProjects, respond: () => new Promise(() => {}) }]);
    renderWithQuery(<DashboardView />);
    expect(screen.getByRole("status", { name: "Loading projects" })).toHaveAttribute("aria-busy", "true");
  });

  it("shows the empty state with Connect GitHub", async () => {
    mockFetch([{ match: isProjects, respond: () => ok({ projects: [] }) }]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/api/github/install");
    expect(screen.getByText("No flows yet")).toBeInTheDocument();
  });

  it("shows an error state with retry", async () => {
    mockFetch([{ match: isProjects, respond: () => fail("INTERNAL", "boom", 500) }]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("Could not load projects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("shows the rate-limit message", async () => {
    mockFetch([{ match: isProjects, respond: () => fail("RATE_LIMITED", "x", 429) }]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("Too many requests, try again in a minute")).toBeInTheDocument();
  });

  it("renders populated project cards", async () => {
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    const cards = await screen.findAllByTestId("project-card");
    expect(cards).toHaveLength(3);
    const first = cards[0]!;
    expect(within(first).getByRole("link", { name: "acme/storefront" })).toHaveAttribute(
      "href",
      `/projects/${projects[0]!.id}`,
    );
    expect(within(first).getByText("main")).toBeInTheDocument();
    expect(within(first).getByText("Not analyzed yet")).toBeInTheDocument();
    expect(within(first).getByText(/Added 9 Nov 2026/)).toBeInTheDocument();
  });

  it("rejects a response that does not match the DTO", async () => {
    mockFetch([{ match: isProjects, respond: () => ok({ projects: [{ id: 1 }] }) }]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("Could not load projects")).toBeInTheDocument();
  });

  it("shows the GitHub connected notice", async () => {
    mockParams = new URLSearchParams("connected=1");
    mockFetch([{ match: isProjects, respond: () => ok({ projects: [] }) }]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("GitHub connected")).toBeInTheDocument();
  });

  it("shows the GitHub error notice", async () => {
    mockParams = new URLSearchParams("error=github");
    mockFetch([{ match: isProjects, respond: () => ok({ projects: [] }) }]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("Could not connect GitHub. Try again.")).toBeInTheDocument();
  });
});

describe("ProjectStatusBadge mapping", () => {
  it("pending → Not analyzed yet", () => {
    render(<ProjectStatusBadge project={{ status: "pending", detectedKind: null }} />);
    expect(screen.getByText("Not analyzed yet")).toBeInTheDocument();
  });
  it("valid → kind shown", () => {
    render(<ProjectStatusBadge project={{ status: "valid", detectedKind: "website" }} />);
    expect(screen.getByText("Valid · website")).toBeInTheDocument();
  });
  it("invalid → outlined Invalid", () => {
    render(<ProjectStatusBadge project={{ status: "invalid", detectedKind: null }} />);
    expect(screen.getByText("Invalid")).toHaveAttribute("data-status", "invalid");
  });
});
