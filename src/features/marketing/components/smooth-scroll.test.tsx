import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lenis = vi.hoisted(() => ({ ctor: vi.fn(), scrollTo: vi.fn(), destroy: vi.fn() }));

vi.mock("lenis", () => ({
  default: class {
    constructor(options: unknown) {
      lenis.ctor(options);
    }
    scrollTo(target: unknown, options: unknown) {
      lenis.scrollTo(target, options);
    }
    destroy() {
      lenis.destroy();
    }
  },
}));
vi.mock("lenis/dist/lenis.css", () => ({}));

import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import { LandingPage } from "@/features/marketing/components/landing-page";
import { SiteHeader } from "@/features/marketing/components/site-header";
import { installMatchMedia, setMedia } from "@/features/marketing/test-media";

function renderLanding() {
  return render(
    <>
      <SiteHeader />
      <main>
        <LandingPage />
      </main>
    </>,
  );
}

/** Every inline transform on the page (Motion writes transforms inline). */
function inlineTransforms(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[style]"))
    .map((el) => el.style.transform)
    .filter((t) => t !== "");
}

beforeEach(() => {
  lenis.ctor.mockClear();
  lenis.scrollTo.mockClear();
  lenis.destroy.mockClear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => vi.unstubAllGlobals());

describe("Reduced motion", () => {
  it("shows four static stacked panels, no tilt, and never starts Lenis", () => {
    installMatchMedia({ reduced: true, finePointer: true, desktop: true });
    renderLanding();
    const section = document.getElementById("how-it-works")!;
    expect(section).toHaveAttribute("data-motion", "reduced");
    expect(section).toHaveAttribute("data-story-layout", "stacked");
    const steps = section.querySelectorAll<HTMLElement>("[data-story-step]");
    expect(steps).toHaveLength(4);
    for (const step of steps) {
      expect(step.style.opacity).not.toBe("0");
      expect(step.querySelector("h3")).not.toBeNull();
      expect(step.querySelector("[data-preview^='step-']")).not.toBeNull();
    }
    for (const transform of inlineTransforms()) expect(transform).not.toMatch(/rotateX/i);
    expect(document.querySelector("[data-hero-frame]")).toBeNull();
    expect(lenis.ctor).not.toHaveBeenCalled();
  });

  it("destroys Lenis at once when reduced motion turns on while the page is open", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    renderLanding();
    expect(lenis.ctor).toHaveBeenCalledTimes(1);
    act(() => setMedia({ reduced: true }));
    expect(lenis.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("Lenis lifecycle (D-56)", () => {
  it("never starts on a device without a fine hovering pointer", () => {
    installMatchMedia({ reduced: false, finePointer: false });
    renderLanding();
    expect(lenis.ctor).not.toHaveBeenCalled();
  });

  it("starts once with the D-56 settings and is destroyed once on unmount", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    const { unmount } = renderLanding();
    expect(lenis.ctor).toHaveBeenCalledTimes(1);
    expect(lenis.ctor).toHaveBeenCalledWith({
      autoRaf: true,
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1,
    });
    unmount();
    expect(lenis.destroy).toHaveBeenCalledTimes(1);
  });

  it("is not mounted by the privacy or terms pages", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    render(<PrivacyPage />);
    render(<TermsPage />);
    expect(lenis.ctor).not.toHaveBeenCalled();
  });
});

describe("Anchor navigation", () => {
  it("header and hero links point at targets that exist once", () => {
    installMatchMedia({ reduced: true });
    renderLanding();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#how-it-works", "#security", "#faq"]);
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
    for (const href of hrefs) expect(document.querySelectorAll(href!)).toHaveLength(1);
  });

  it("with Lenis active, scrolls through lenis.scrollTo with an 80 px offset, then focuses the heading", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    renderLanding();
    fireEvent.click(screen.getByRole("link", { name: "See how it works" }));
    expect(lenis.scrollTo).toHaveBeenCalledTimes(1);
    const [target, options] = lenis.scrollTo.mock.calls[0]! as [
      HTMLElement,
      { offset: number; onComplete: () => void },
    ];
    expect(target).toBe(document.getElementById("how-it-works"));
    expect(options.offset).toBe(-80);
    expect(window.location.hash).toBe("#how-it-works");
    act(() => options.onComplete());
    expect(document.activeElement).toBe(document.getElementById("how-it-works-heading"));
  });

  it("header nav links work the same way", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    renderLanding();
    const nav = screen.getByRole("navigation", { name: "Main" });
    fireEvent.click(nav.querySelector('a[href="#faq"]')!);
    const [target, options] = lenis.scrollTo.mock.calls[0]! as [HTMLElement, { offset: number; onComplete: () => void }];
    expect(target).toBe(document.getElementById("faq"));
    expect(options.offset).toBe(-80);
    act(() => options.onComplete());
    expect(document.activeElement).toBe(document.getElementById("faq-heading"));
  });

  it("without Lenis leaves anchors to the browser", () => {
    installMatchMedia({ reduced: true, finePointer: true });
    renderLanding();
    const link = screen.getByRole("link", { name: "See how it works" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(lenis.scrollTo).not.toHaveBeenCalled();
  });

  it("on /privacy and /terms the header anchors point back to /#…", () => {
    installMatchMedia({ reduced: true });
    for (const Page of [PrivacyPage, TermsPage]) {
      const { unmount } = render(<Page />);
      const nav = screen.getByRole("navigation", { name: "Main" });
      expect(Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
        "/#how-it-works",
        "/#security",
        "/#faq",
      ]);
      unmount();
    }
  });
});

describe("How it works variants", () => {
  it("uses the sticky story on desktop with motion allowed", () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true });
    renderLanding();
    const section = document.getElementById("how-it-works")!;
    expect(section).toHaveAttribute("data-motion", "full");
    expect(section).toHaveAttribute("data-story-layout", "sticky");
    expect(section.querySelectorAll("[data-story-step]")).toHaveLength(4);
    const visual = section.querySelector("[data-story-visual='sticky']")!;
    expect(visual.className).toContain("sticky");
    expect(visual.querySelectorAll("[data-story-visual-state]")).toHaveLength(4);
    expect(section.querySelector("[data-story-step='connect']")).toHaveAttribute("data-active", "true");
  });

  it("uses stacked panels under 768 px with motion allowed", () => {
    installMatchMedia({ reduced: false, finePointer: false, desktop: false });
    renderLanding();
    const section = document.getElementById("how-it-works")!;
    expect(section).toHaveAttribute("data-motion", "full");
    expect(section).toHaveAttribute("data-story-layout", "stacked");
    expect(section.querySelectorAll("[data-story-step]")).toHaveLength(4);
    expect(section.querySelector("[data-story-visual='sticky']")).toBeNull();
  });
});
