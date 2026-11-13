import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { branchRows } from "@/features/github/components/branch-picker";
import { RepoPicker } from "@/features/github/components/repo-picker";
import {
  refreshRequiredError,
  acmeInstallation,
  branchesPage1,
  branchesPage2,
  installations,
  repoPage1,
  repoPage2,
} from "@/features/github/fixtures";
import { pendingProject } from "@/features/projects/fixtures";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => vi.unstubAllGlobals());

const reposUrl = (page: number) => `/api/github/installations/${acmeInstallation.id}/repos?page=${page}`;
const branchesUrl = (page: number, repo = "acme/storefront") =>
  `/api/github/installations/${acmeInstallation.id}/branches?repo=${encodeURIComponent(repo)}&page=${page}`;

type Responder = () => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

function serve(opts: { post?: Responder; branches1?: Responder } = {}) {
  return mockFetch([
    { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
    { match: (u) => u === reposUrl(1), respond: () => ok(repoPage1) },
    { match: (u) => u === reposUrl(2), respond: () => ok(repoPage2) },
    { match: (u) => u === branchesUrl(1), respond: opts.branches1 ?? (() => ok(branchesPage1)) },
    { match: (u) => u === branchesUrl(2), respond: () => ok(branchesPage2) },
    { method: "POST", match: (u) => u === "/api/projects", respond: opts.post ?? (() => ok(pendingProject, 201)) },
  ]);
}

async function goToBranchStep(onStepChange = vi.fn()) {
  const onCreated = vi.fn();
  renderWithQuery(<RepoPicker onCreated={onCreated} onCancel={vi.fn()} onStepChange={onStepChange} />);
  fireEvent.click(await screen.findByRole("radio", { name: /acme\/storefront/ }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("radio", { name: /develop/ });
  return { onCreated };
}

const rowFor = (name: string) => document.querySelector(`[data-branch="${name}"]`) as HTMLElement | null;

describe("RepoPicker step 1 (repository)", () => {
  it("pages through repos with Load more; Next is enabled once a repo is selected", async () => {
    serve();
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText("acme/storefront")).toBeInTheDocument();
    expect(screen.queryByText("acme/billing-service")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("acme/billing-service")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument());

    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /acme\/landing/ }));
    expect(next).toBeEnabled();
  });

  it("has the Link existing installation and Connect another account links", async () => {
    serve();
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("link", { name: "Link existing installation" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
    expect(screen.getByRole("link", { name: "Connect another account" })).toHaveAttribute("href", "/api/github/install");
  });

  it("shows Connect GitHub and Link existing installation when there are no installations", async () => {
    mockFetch([{ match: (u) => u === "/api/github/installations", respond: () => ok({ installations: [] }) }]);
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/api/github/install");
    expect(screen.getByRole("link", { name: "Link existing installation" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
  });

  it("shows an error state when repos fail to load", async () => {
    mockFetch([
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
      { match: (u) => u === reposUrl(1), respond: () => fail("INTERNAL", "x", 500) },
    ]);
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText("Could not load repositories")).toBeInTheDocument();
  });

  it("shows the empty repo state", async () => {
    mockFetch([
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
      { match: (u) => u === reposUrl(1), respond: () => ok({ repos: [], page: 1, hasMore: false }) },
    ]);
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText(/No repositories in this installation/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Grant access to repositories on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/settings/installations/12345678",
    );
  });
});

describe("RepoPicker step 2 (branch)", () => {
  it("pins the default first and preselects it even when it is not in the loaded page", async () => {
    const onStepChange = vi.fn();
    serve();
    await goToBranchStep(onStepChange);
    expect(onStepChange).toHaveBeenLastCalledWith("branch");
    expect(screen.getByTestId("selected-repo")).toHaveTextContent("acme/storefront");

    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      "main",
      "develop",
      "feature/checkout",
      "release/2026-11",
    ]);
    expect(screen.getByRole("radio", { name: /main/ })).toBeChecked();
    expect(within(rowFor("main")!).getByText("default")).toBeInTheDocument();
    expect(within(rowFor("develop")!).queryByText("default")).toBeNull();
  });

  it("marks protected branches", async () => {
    serve();
    await goToBranchStep();
    expect(within(rowFor("develop")!).getByText("Protected")).toBeInTheDocument();
    expect(within(rowFor("feature/checkout")!).queryByText("Protected")).toBeNull();
  });

  it("Load more branches appends and never lists the default twice", async () => {
    serve();
    await goToBranchStep();
    fireEvent.click(screen.getByRole("button", { name: "Load more branches" }));
    expect(await screen.findByRole("radio", { name: /hotfix\/cart/ })).toBeInTheDocument();
    const values = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(values).toEqual(["main", "develop", "feature/checkout", "release/2026-11", "hotfix/cart"]);
    // Now that main is loaded, its protected flag shows on the pinned row.
    expect(within(rowFor("main")!).getByText("Protected")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Load more branches" })).not.toBeInTheDocument(),
    );
  });

  it("filter narrows loaded branches only, case-insensitive, with the no-match message", async () => {
    const fetchMock = serve();
    await goToBranchStep();
    const callsBefore = fetchMock.mock.calls.length;
    const search = screen.getByRole("searchbox", { name: "Search branches" });
    expect(search).toHaveAttribute("placeholder", "Filter loaded branches");
    fireEvent.change(search, { target: { value: "FEATURE" } });
    // The selected default stays visible (R11-9); the filter narrows the rest.
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([
      "main",
      "feature/checkout",
    ]);
    fireEvent.change(search, { target: { value: "hotfix" } });
    expect(screen.getByText("No loaded branch matches. Load more branches or check the name.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("the filter never hides the selected branch, so what is submitted is always visible (R11-9)", async () => {
    const fetchMock = serve();
    const { onCreated } = await goToBranchStep();
    fireEvent.click(screen.getByRole("radio", { name: /develop/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search branches" }), { target: { value: "release" } });
    const visible = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(visible).toEqual(["develop", "release/2026-11"]);
    expect(screen.getByRole("radio", { name: /develop/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const sent = JSON.parse(String(post?.[1]?.body)).branch;
    expect(visible).toContain(sent);
  });

  it("confirm sends the chosen branch", async () => {
    const fetchMock = serve();
    const { onCreated } = await goToBranchStep();
    fireEvent.click(screen.getByRole("radio", { name: /release\/2026-11/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      repoFullName: "acme/storefront",
      installationId: acmeInstallation.id,
      branch: "release/2026-11",
    });
  });

  it("confirm with the preselected default sends it", async () => {
    const fetchMock = serve();
    const { onCreated } = await goToBranchStep();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).branch).toBe("main");
  });

  it("Back returns to the repo step and keeps the selection", async () => {
    const onStepChange = vi.fn();
    serve();
    await goToBranchStep(onStepChange);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onStepChange).toHaveBeenLastCalledWith("repo");
    expect(await screen.findByRole("radio", { name: /acme\/storefront/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it.each(["That branch was not found.", "This repository and branch are already connected"])(
    "shows the VALIDATION_ERROR message inline: %s",
    async (message) => {
      serve({ post: () => fail("VALIDATION_ERROR", message, 400) });
      await goToBranchStep();
      fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    },
  );

  it("RATE_LIMITED uses the shared copy", async () => {
    serve({ post: () => fail("RATE_LIMITED", "x", 429) });
    await goToBranchStep();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    expect(await screen.findByText("Too many requests, try again in a minute")).toBeInTheDocument();
  });

  it("load error shows the retry state", async () => {
    let calls = 0;
    serve({ branches1: () => (calls++ === 0 ? fail("INTERNAL", "x", 500) : ok(branchesPage1)) });
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: /acme\/storefront/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Could not load branches. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("radio", { name: /develop/ })).toBeInTheDocument();
  });
});

describe("branchRows", () => {
  it("pins the default, keeps GitHub order, dedupes, and filters", () => {
    const rows = branchRows("main", [...branchesPage1.branches, ...branchesPage2.branches], "");
    expect(rows.map((r) => r.name)).toEqual(["main", "develop", "feature/checkout", "release/2026-11", "hotfix/cart"]);
    expect(rows[0]).toEqual({ name: "main", protected: true, isDefault: true });
    expect(branchRows("main", branchesPage1.branches, "")[0]).toEqual({ name: "main", protected: null, isDefault: true });
    expect(branchRows("main", branchesPage1.branches, "REL").map((r) => r.name)).toEqual(["release/2026-11"]);
    expect(branchRows("main", branchesPage1.branches, "REL", "main").map((r) => r.name)).toEqual([
      "main",
      "release/2026-11",
    ]);
  });
});

const refresh = () => fail(refreshRequiredError.code, refreshRequiredError.message, refreshRequiredError.status);
const REFRESH = "Flow Motion needs to re-check which repositories you can access on GitHub. This happens at least once a day.";

function expectRefreshNotice() {
  const notice = document.querySelector('[data-notice="refresh-access"]') as HTMLElement;
  expect(notice).not.toBeNull();
  expect(within(notice).getByText(REFRESH)).toBeInTheDocument();
  expect(within(notice).getByRole("link", { name: "Refresh repository access" })).toHaveAttribute(
    "href",
    "/api/github/authorize",
  );
}

describe("GITHUB_REFRESH_REQUIRED surfaces (D-22)", () => {
  it("step 1 footer: Missing a repository? Refresh repository access", async () => {
    serve();
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    const footer = await screen.findByTestId("missing-repo");
    expect(footer).toHaveTextContent("Missing a repository? Refresh repository access");
    expect(within(footer).getByRole("link")).toHaveTextContent(/^Refresh repository access$/);
    expect(within(footer).getByRole("link")).toHaveAttribute("href", "/api/github/authorize");
  });

  it("repos list: notice in place of the list", async () => {
    mockFetch([
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
      { match: (u) => u === reposUrl(1), respond: refresh },
    ]);
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText(REFRESH);
    expectRefreshNotice();
    expect(screen.queryByText("Could not load repositories")).not.toBeInTheDocument();
  });

  it("branches: notice under the branch list area", async () => {
    serve({ branches1: refresh });
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: /acme\/storefront/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(REFRESH);
    expectRefreshNotice();
    expect(screen.queryByText("Could not load branches. Try again.")).not.toBeInTheDocument();
  });

  it("create: notice above the buttons", async () => {
    serve({ post: refresh });
    await goToBranchStep();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await screen.findByText(REFRESH);
    expectRefreshNotice();
    expect(screen.queryByText("Something went wrong. Try again.")).not.toBeInTheDocument();
  });
});
