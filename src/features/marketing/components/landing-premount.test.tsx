import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("lenis", () => ({
  default: class {
    destroy() {}
  },
}));
vi.mock("lenis/dist/lenis.css", () => ({}));
// Before `useMounted` turns true (contract M10 e): mounted and motion are false.
vi.mock("@/features/marketing/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/marketing/hooks")>()),
  useMounted: () => false,
  useMotionAllowed: () => false,
}));

import { FAQ, FEATURES, FINAL_CTA, HOW_IT_WORKS, SECURITY } from "@/features/marketing/copy";
import { LandingPage } from "@/features/marketing/components/landing-page";
import { SiteHeader } from "@/features/marketing/components/site-header";
import { installMatchMedia } from "@/features/marketing/test-media";

afterEach(() => vi.unstubAllGlobals());

describe("M10 e: client render before mount", () => {
  it("matches the server render: plain headings, no decorative layer, no hidden content", () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true, wide: true });
    render(
      <>
        <SiteHeader drawWordmark />
        <LandingPage />
      </>,
    );
    for (const marker of [
      "[data-flow-line]",
      "[data-flow-dot]",
      "[data-flow-node]",
      "[data-hero-chip]",
      "[data-word]",
      "[data-flow-output]",
    ]) {
      expect(document.querySelectorAll(marker), marker).toHaveLength(0);
    }
    for (const text of [HOW_IT_WORKS.heading, FEATURES.heading, SECURITY.heading, FAQ.heading, FINAL_CTA.heading]) {
      const heading = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent === text);
      expect(heading, text).toBeDefined();
      expect(heading!.children).toHaveLength(0);
    }
    for (const el of document.querySelectorAll<HTMLElement>("[style]")) {
      expect(el.style.opacity).not.toBe("0");
      expect(el.style.transform).not.toMatch(/rotateX/i);
    }
    for (const magnet of document.querySelectorAll<HTMLElement>("[data-magnetic]")) {
      expect(magnet.style.transform).toBe("");
    }
    expect(document.querySelector("[data-wordmark-line]")).toHaveAttribute("data-wordmark-line", "static");
    // Both story structures are present; CSS shows one of them (RL-1).
    expect(document.querySelector("[data-story-visual='sticky']")).not.toBeNull();
    expect(document.querySelectorAll("#how-it-works [data-story-step] [data-preview^='step-']")).toHaveLength(4);
  });
});
