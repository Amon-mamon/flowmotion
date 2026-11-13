import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisplayNameForm } from "@/features/profile/components/display-name-form";
import { SettingsView } from "@/features/profile/components/settings-view";
import { installations } from "@/features/github/fixtures";
import { profile } from "@/features/profile/fixtures";
import { mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => vi.unstubAllGlobals());

describe("DisplayNameForm", () => {
  it("rejects an empty (whitespace) name", async () => {
    const fetchMock = mockFetch([]);
    renderWithQuery(<DisplayNameForm profile={profile} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Display name must be 1 to 80 characters")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a trimmed PATCH", async () => {
    const fetchMock = mockFetch([
      { method: "PATCH", match: (u) => u === "/api/profile", respond: () => ok({ ...profile, displayName: "Janet" }) },
    ]);
    renderWithQuery(<DisplayNameForm profile={profile} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  Janet " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Display name saved.")).toBeInTheDocument();
    const call = fetchMock.mock.calls[0];
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ displayName: "Janet" });
  });
});

describe("SettingsView", () => {
  it("lists installations with Manage on GitHub links", async () => {
    mockFetch([
      { match: (u) => u === "/api/profile", respond: () => ok(profile) },
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
    ]);
    renderWithQuery(<SettingsView />);
    expect(await screen.findByText("acme")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Manage on GitHub/ });
    expect(links[0]).toHaveAttribute("href", "https://github.com/settings/installations/12345678");
    expect(screen.getByRole("link", { name: "Connect another account" })).toHaveAttribute(
      "href",
      "/api/github/install",
    );
    expect(screen.getByRole("link", { name: "Link existing installation" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
    await waitFor(() => expect(screen.getByLabelText("Display name")).toHaveValue("Jane Example"));
    expect(screen.queryByText(/plan/i)).not.toBeInTheDocument();
  });

  it("shows the installations empty state", async () => {
    mockFetch([
      { match: (u) => u === "/api/profile", respond: () => ok(profile) },
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations: [] }) },
    ]);
    renderWithQuery(<SettingsView />);
    expect(await screen.findByText("No GitHub installation connected")).toBeInTheDocument();
  });
});

describe("SettingsView installations (D-22)", () => {
  it("shows Linked as @login, and Needs refresh with the refresh link only where needed", async () => {
    mockFetch([
      { match: (u) => u === "/api/profile", respond: () => ok(profile) },
      { match: (u) => u === "/api/github/installations", respond: () => ok({ installations }) },
    ]);
    renderWithQuery(<SettingsView />);
    const list = await screen.findByRole("list", { name: "Connected GitHub installations" });
    const [acme, personal] = within(list).getAllByRole("listitem");
    // acme: linked by jane-example, fresh.
    expect(within(acme!).getByText("Linked as @jane-example")).toBeInTheDocument();
    expect(within(acme!).queryByText("Needs refresh")).toBeNull();
    expect(within(acme!).queryByRole("link", { name: "Refresh repository access" })).toBeNull();
    // personal: linked before D-22 (no login), needs refresh.
    expect(within(personal!).queryByText(/Linked as/)).toBeNull();
    expect(within(personal!).getByText("Needs refresh")).toBeInTheDocument();
    expect(within(personal!).getByRole("link", { name: "Refresh repository access" })).toHaveAttribute(
      "href",
      "/api/github/authorize",
    );
  });
});
