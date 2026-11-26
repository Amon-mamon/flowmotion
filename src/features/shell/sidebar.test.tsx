import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/integrations";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { profile } from "@/features/profile/fixtures";
import { SidebarContent } from "@/features/shell/sidebar";
import { mockFetch, ok, renderWithQuery } from "@/features/test-utils/render";

afterEach(() => {
  vi.unstubAllGlobals();
  pathname = "/integrations";
});

function renderSidebar() {
  mockFetch([{ match: (u) => u === "/api/profile", respond: () => ok(profile) }]);
  renderWithQuery(<SidebarContent />);
  return screen.getByRole("navigation", { name: "Main" });
}

describe("Sidebar (Phase 2e-ui item 2)", () => {
  it("lists Dashboard, Integrations, Settings in that order", () => {
    const nav = renderSidebar();
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual(["Dashboard", "Integrations", "Settings"]);
  });

  it("Integrations links to /integrations and is active on that path", () => {
    const nav = renderSidebar();
    const link = within(nav).getByRole("link", { name: "Integrations" });
    expect(link).toHaveAttribute("href", "/integrations");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("is active below /integrations and not on a lookalike path", () => {
    pathname = "/integrations/ai";
    const nav = renderSidebar();
    expect(within(nav).getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
  });

  it("is not active on /integrationsx", () => {
    pathname = "/integrationsx";
    const nav = renderSidebar();
    expect(within(nav).getByRole("link", { name: "Integrations" })).not.toHaveAttribute("aria-current");
  });
});
