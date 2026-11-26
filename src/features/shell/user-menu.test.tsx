import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { profile } from "@/features/profile/fixtures";
import { UserMenu } from "@/features/shell/user-menu";
import { mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  push.mockReset();
  refresh.mockReset();
});

const isProfile = (u: string) => u === "/api/profile";
const isSignOut = (u: string) => u === "/api/auth/sign-out";

/** Renders the real menu (real Base UI primitives) and opens it so the email label mounts. */
async function openMenu() {
  const fetchMock = mockFetch([
    { match: isProfile, respond: () => ok(profile) },
    { method: "POST", match: isSignOut, respond: () => ok({ signedOut: true }) },
  ]);
  const consoleError = vi.spyOn(console, "error");
  renderWithQuery(<UserMenu />);
  const trigger = await screen.findByRole("button", { name: "Account menu" });
  fireEvent.click(trigger);
  await screen.findByRole("menu");
  return { fetchMock, consoleError };
}

describe("UserMenu", () => {
  it("opens without a menu context error and shows the email label", async () => {
    const { consoleError } = await openMenu();
    expect(screen.getByText(profile.email)).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("Settings still links to /settings", async () => {
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("Sign out sends POST /api/auth/sign-out once", async () => {
    const { fetchMock, consoleError } = await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    const signOutCalls = fetchMock.mock.calls.filter(
      ([input, init]) => isSignOut(String(input)) && init?.method === "POST",
    );
    expect(signOutCalls).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
