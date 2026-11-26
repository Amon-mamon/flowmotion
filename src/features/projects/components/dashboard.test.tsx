import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { installations } from "@/features/github/fixtures";
import { render } from "@testing-library/react";

afterEach(() => {
  vi.unstubAllGlobals();
  mockParams = new URLSearchParams();
});

const isProjects = (u: string) => u === "/api/projects";
const isInstallations = (u: string) => u === "/api/github/installations";

describe("Dashboard projects grid", () => {
  it("shows a loading state", () => {
    mockFetch([{ match: isProjects, respond: () => new Promise(() => {}) }]);
    renderWithQuery(<DashboardView />);
    expect(screen.getByRole("status", { name: "Loading projects" })).toHaveAttribute("aria-busy", "true");
  });

  it("empty + no installations: Connect GitHub", async () => {
    mockFetch([
      { match: isProjects, respond: () => ok({ projects: [] }) },
      { match: isInstallations, respond: () => ok({ installations: [] }) },
    ]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Connect GitHub to choose a repository.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/api/github/install");
    expect(screen.getByText(/Already installed Flow Motion on GitHub\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Link existing installation" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
    expect(screen.getByText("No flows yet")).toBeInTheDocument();
  });

  it("empty + an installation: Add repository opens the dialog, no Connect GitHub", async () => {
    mockFetch([
      { match: isProjects, respond: () => ok({ projects: [] }) },
      { match: isInstallations, respond: () => ok({ installations }) },
      { match: (u) => u.includes("/repos?page="), respond: () => new Promise(() => {}) },
    ]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("Add a repository to analyze it.")).toBeInTheDocument();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect GitHub" })).not.toBeInTheDocument();
    const emptyState = screen.getByText("No projects yet").closest("[role=status]") as HTMLElement;
    fireEvent.click(within(emptyState).getByRole("button", { name: "Add repository" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("empty while installations load: skeleton, never the wrong button", async () => {
    mockFetch([
      { match: isProjects, respond: () => ok({ projects: [] }) },
      { match: isInstallations, respond: () => new Promise(() => {}) },
    ]);
    renderWithQuery(<DashboardView />);
    await waitFor(() => expect(screen.getByRole("status", { name: "Loading projects" })).toBeInTheDocument());
    // Give the projects response time to resolve; the skeleton must stay.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("status", { name: "Loading projects" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect GitHub" })).not.toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
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

describe("Phase 1.1 dashboard", () => {
  it("cards show the chosen branch, not the default branch", async () => {
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    const cards = await screen.findAllByTestId("project-card");
    // validProject: default "develop", chosen "release/2026-11".
    expect(within(cards[1]!).getByTestId("project-branch")).toHaveTextContent("release/2026-11");
    expect(within(cards[1]!).queryByText("develop")).not.toBeInTheDocument();
  });

  it("shows the github_none notice with the Connect GitHub link", async () => {
    mockParams = new URLSearchParams("error=github_none");
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-notice="github-none"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    // Exact Phase 1.2 copy (design.md) followed by the link.
    expect(notice).toHaveTextContent(
      /^Flow Motion is not installed on your GitHub account or on an organization you belong to\. Install it first\. Connect GitHub$/,
    );
    expect(screen.queryByText(/any GitHub account you can access/)).not.toBeInTheDocument();
    expect(within(notice).getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/api/github/install");
  });
});

describe("Dashboard empty state with a failed installations request (R11-8)", () => {
  it("shows the error state with Retry and neither empty-state action", async () => {
    mockFetch([
      { match: isProjects, respond: () => ok({ projects: [] }) },
      { match: isInstallations, respond: () => fail("INTERNAL", "boom", 500) },
    ]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("Could not load GitHub connections")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect GitHub" })).not.toBeInTheDocument();
    // Only the header's dialog trigger exists, not an empty-state action.
    expect(screen.getAllByRole("button", { name: "Add repository" })).toHaveLength(1);
  });
});

describe("Dashboard GitHub notices (D-22, D-23)", () => {
  it("connected=1 names the GitHub account", async () => {
    mockParams = new URLSearchParams("connected=1");
    mockFetch([
      { match: isProjects, respond: () => ok({ projects }) },
      { match: isInstallations, respond: () => ok({ installations }) },
    ]);
    renderWithQuery(<DashboardView />);
    expect(await screen.findByText("GitHub connected as @jane-example")).toBeInTheDocument();
  });

  it("connected=1 without any login stays plain", async () => {
    mockParams = new URLSearchParams("connected=1");
    mockFetch([
      { match: isProjects, respond: () => ok({ projects }) },
      {
        match: isInstallations,
        respond: () => ok({ installations: installations.map((i) => ({ ...i, githubUserLogin: null })) }),
      },
    ]);
    renderWithQuery(<DashboardView />);
    await waitFor(() =>
      expect(document.querySelector('[data-notice="connected"]')).toHaveTextContent(/^GitHub connected$/),
    );
  });

  it("link=github: notice with the Link existing installation button", async () => {
    mockParams = new URLSearchParams("link=github");
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    expect(
      await screen.findByText("Flow Motion was installed or updated on GitHub. Link it to your account to continue."),
    ).toBeInTheDocument();
    const notice = document.querySelector('[data-notice="link-github"]') as HTMLElement;
    expect(within(notice).getByRole("link", { name: "Link existing installation" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
  });

  it("error=github_account: notice with a Settings link", async () => {
    mockParams = new URLSearchParams("error=github_account");
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-notice="github-account"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(notice).toHaveTextContent(
      "You are signed in to GitHub with a different account than the one linked to Flow Motion. Switch accounts on GitHub, or disconnect the linked installations in Settings first.",
    );
    expect(within(notice).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});

describe("Phase 1.2 GitHub account isolation (D-43, D-44, D-45)", () => {
  it("error=github_in_use: plain notice with the exact copy, no link", async () => {
    mockParams = new URLSearchParams("error=github_in_use");
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-notice="github-in-use"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(notice).toHaveTextContent(
      /^This GitHub account is already linked to another Flow Motion account\. Sign in to Flow Motion with that account, or disconnect GitHub in its Settings first\. To use a different GitHub account, switch accounts on GitHub and try again\.$/,
    );
    expect(within(notice).queryByRole("link")).not.toBeInTheDocument();
    expect(notice).not.toHaveAttribute("role", "alert");
    expect(screen.queryByText("Could not connect GitHub. Try again.")).not.toBeInTheDocument();
  });

  it("a card with installationId null shows Not connected to GitHub; one with an installation does not", async () => {
    mockFetch([{ match: isProjects, respond: () => ok({ projects }) }]);
    renderWithQuery(<DashboardView />);
    const cards = await screen.findAllByTestId("project-card");
    expect(cards).toHaveLength(3);
    // projects = [pending (installed), valid (installed), invalid (installationId null)]; never hidden.
    expect(within(cards[2]!).getByText("Not connected to GitHub")).toBeInTheDocument();
    expect(within(cards[0]!).queryByText("Not connected to GitHub")).not.toBeInTheDocument();
    expect(within(cards[1]!).queryByText("Not connected to GitHub")).not.toBeInTheDocument();
  });
});
