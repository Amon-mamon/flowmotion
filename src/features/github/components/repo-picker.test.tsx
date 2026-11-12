import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepoPicker } from "@/features/github/components/repo-picker";
import { acmeInstallation, installations, repoPage1, repoPage2 } from "@/features/github/fixtures";
import { pendingProject } from "@/features/projects/fixtures";
import { fail, mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => vi.unstubAllGlobals());

const reposUrl = (page: number) => `/api/github/installations/${acmeInstallation.id}/repos?page=${page}`;

describe("RepoPicker", () => {
  it("pages through repos with Load more and creates a project", async () => {
    const fetchMock = mockFetch([
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
      { match: (u) => u === reposUrl(1), respond: () => ok(repoPage1) },
      { match: (u) => u === reposUrl(2), respond: () => ok(repoPage2) },
      { method: "POST", match: (u) => u === "/api/projects", respond: () => ok(pendingProject, 201) },
    ]);
    const onCreated = vi.fn();
    renderWithQuery(<RepoPicker onCreated={onCreated} onCancel={vi.fn()} />);

    expect(await screen.findByText("acme/storefront")).toBeInTheDocument();
    expect(screen.queryByText("acme/billing-service")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("acme/billing-service")).toBeInTheDocument();
    expect(screen.getByText("acme/storefront")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument());

    const add = screen.getByRole("button", { name: "Add repository" });
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /acme\/landing/ }));
    expect(add).toBeEnabled();
    fireEvent.click(add);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      repoFullName: "acme/landing",
      installationId: acmeInstallation.id,
    });
  });

  it("shows the duplicate-repo validation message", async () => {
    mockFetch([
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
      { match: (u) => u === reposUrl(1), respond: () => ok({ ...repoPage1, hasMore: false }) },
      {
        method: "POST",
        match: (u) => u === "/api/projects",
        respond: () => fail("VALIDATION_ERROR", "This repository is already connected", 400),
      },
    ]);
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: /acme\/storefront/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    expect(await screen.findByText("This repository is already connected")).toBeInTheDocument();
  });

  it("shows Connect GitHub when there are no installations", async () => {
    mockFetch([{ match: (u) => u === "/api/github/installations", respond: () => ok({ installations: [] }) }]);
    renderWithQuery(<RepoPicker onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("link", { name: "Connect GitHub" })).toHaveAttribute(
      "href",
      "/api/github/install",
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
    expect(screen.getByRole("link", { name: "Connect another account" })).toHaveAttribute(
      "href",
      "/api/github/install",
    );
  });
});
