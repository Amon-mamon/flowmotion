import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderToString } from "react-dom/server";

import { HowItWorks, steps } from "@/features/marketing/components/how-it-works";
import { LandingPage } from "@/features/marketing/components/landing-page";
import { PLANS_BODY, PLANS_HEADING } from "@/features/marketing/components/plans-coming-soon";
import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Landing page", () => {
  it("renders every section from design.md", () => {
    setReducedMotion(false);
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Get started/ })).toHaveAttribute("href", "/signup");
    for (const id of ["how-it-works", "features", "security", "plans", "faq"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(screen.getByRole("heading", { name: "Repo scan" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Node flows" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Simulation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "n8n export" })).toBeInTheDocument();
  });

  it("shows the exact Plans coming soon copy and nothing else there", () => {
    setReducedMotion(false);
    render(<LandingPage />);
    expect(PLANS_HEADING).toBe("Plans coming soon");
    expect(PLANS_BODY).toBe(
      "Flow Motion is in early testing. There are no paid plans, prices, or credits yet. Pricing will be announced here before anything changes.",
    );
    const section = document.getElementById("plans")!;
    expect(section.querySelector("h2")?.textContent).toBe(PLANS_HEADING);
    expect(section.textContent).toBe(PLANS_HEADING + PLANS_BODY);
    expect(section.querySelectorAll("a, button")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\$\d|€\d|checkout|guaranteed/i);
  });

  it("uses the full scroll story when motion is allowed", () => {
    setReducedMotion(false);
    render(<LandingPage />);
    expect(document.getElementById("how-it-works")).toHaveAttribute("data-motion", "full");
  });

  it("falls back to fades when prefers-reduced-motion is set", () => {
    setReducedMotion(true);
    render(<LandingPage />);
    const section = document.getElementById("how-it-works")!;
    expect(section).toHaveAttribute("data-motion", "reduced");
    for (const li of section.querySelectorAll("li")) {
      expect((li as HTMLElement).style.transform).not.toMatch(/rotateX/);
    }
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThanOrEqual(3);
  });

  it("server-renders the story cards fully visible (no opacity 0 before hydration)", () => {
    const html = renderToString(<HowItWorks />);
    expect(html).toContain('data-story-card="static"');
    expect(html).not.toMatch(/opacity:\s*0/);
    for (const step of steps) expect(html).toContain(step.title);
  });

  it("header links to login and signup; footer links to privacy and terms", () => {
    render(
      <>
        <SiteHeader />
        <SiteFooter />
      </>,
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});
