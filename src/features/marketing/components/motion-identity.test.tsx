import { act, render, screen, within } from "@testing-library/react";
import type { MotionValue } from "motion/react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * happy-dom has no layout, so Motion's real `useScroll` reports odd progress
 * (the hero reads as fully scrolled, chips assembled). Every `useScroll` here
 * returns shared values the tests drive, starting at the top of the page.
 */
const scroll = vi.hoisted(() => ({
  y: null as MotionValue<number> | null,
  progress: null as MotionValue<number> | null,
}));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  scroll.y = actual.motionValue(0);
  scroll.progress = actual.motionValue(0);
  const zero = actual.motionValue(0);
  return {
    ...actual,
    useScroll: () => ({ scrollX: zero, scrollXProgress: zero, scrollY: scroll.y!, scrollYProgress: scroll.progress! }),
  };
});

import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import { FAQ, FEATURES, FINAL_CTA, HERO, HOW_IT_WORKS, SECURITY } from "@/features/marketing/copy";
import { FlowNodes } from "@/features/marketing/components/flow-line";
import { LandingPage } from "@/features/marketing/components/landing-page";
import { PLANS_HEADING } from "@/features/marketing/components/plans-coming-soon";
import { SectionIntro } from "@/features/marketing/components/section-intro";
import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";
import { FlowStoreProvider, useFlowStore, type FlowStore } from "@/features/marketing/flow-store";
import { installMatchMedia } from "@/features/marketing/test-media";

/**
 * Landing motion identity (contract section 11, M10 a-g, i) plus the
 * review fixes RL-1, RL-2, RL-3. happy-dom has no layout, so measurements
 * are zero unless a test stubs getBoundingClientRect.
 */

/**
 * Controllable IntersectionObserver (RM-6): every observed target reports the
 * current `io.intersecting`; `setIntersecting` reports a change to all.
 */
const io = { intersecting: true, observers: new Set<ControlledObserver>() };

class ControlledObserver {
  private readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    io.observers.add(this);
  }
  report(targets: Iterable<Element>) {
    const entries = [...targets].map(
      (target) => ({ target, isIntersecting: io.intersecting, intersectionRatio: io.intersecting ? 1 : 0 }) as unknown as IntersectionObserverEntry,
    );
    if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver);
  }
  observe(target: Element) {
    this.targets.add(target);
    queueMicrotask(() => this.report([target]));
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    io.observers.delete(this);
  }
  takeRecords() {
    return [];
  }
  reportAll() {
    this.report(this.targets);
  }
}

function setIntersecting(value: boolean) {
  io.intersecting = value;
  for (const observer of [...io.observers]) observer.reportAll();
}

const SECTION_HEADINGS = [HOW_IT_WORKS.heading, FEATURES.heading, SECURITY.heading, FAQ.heading, FINAL_CTA.heading];
const ALL_HEADINGS = [HERO.heading, ...SECTION_HEADINGS, PLANS_HEADING];

function renderLanding() {
  return render(
    <>
      <SiteHeader drawWordmark />
      <main>
        <LandingPage />
      </main>
      <SiteFooter />
    </>,
  );
}

async function flush(frames = 4) {
  for (let i = 0; i < frames; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
  }
}

function pointer(type: string, target: EventTarget, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
}

/** Pretend every element sits far below the fold (intros and cards start hidden). */
function placeEverythingBelowFold() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 5000, 100, 40));
}

// happy-dom's Web Animations stub never writes styles and rejects on cancel;
// without it Motion runs every animation on its JS frame loop instead.
const nativeAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
beforeAll(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
});
afterAll(() => {
  if (nativeAnimate) Object.defineProperty(Element.prototype, "animate", nativeAnimate);
});

const chipTransforms = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-hero-chip]")).map((chip) => chip.style.transform);

beforeEach(() => {
  lenis.ctor.mockClear();
  lenis.destroy.mockClear();
  io.intersecting = true;
  io.observers.clear();
  scroll.y!.set(0);
  scroll.progress!.set(0);
  vi.stubGlobal("IntersectionObserver", ControlledObserver);
  // Motion's inView checks `instanceof EventTarget`; point the global at the
  // DOM's own EventTarget so elements are observed at all in happy-dom.
  vi.stubGlobal("EventTarget", Object.getPrototypeOf(Node.prototype).constructor);
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("M10 a: reduced motion", () => {
  it("static line, every node lit, no dots, pulses, words, parallax, magnet, or Lenis", async () => {
    installMatchMedia({ reduced: true, finePointer: true, desktop: true, wide: true });
    renderLanding();
    await flush();

    const layer = document.querySelector("[data-flow-line]")!;
    expect(layer).toHaveAttribute("data-flow-line", "static");
    expect(document.querySelectorAll("[data-flow-dot]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-flow-pulse]")).toHaveLength(0);
    for (const path of layer.querySelectorAll("path")) {
      expect(path.getAttribute("style") ?? "").not.toMatch(/stroke-dash/);
      expect(path.hasAttribute("stroke-dashoffset")).toBe(false);
    }
    const nodes = document.querySelectorAll("[data-flow-node]");
    expect(nodes).toHaveLength(6);
    for (const node of nodes) expect(node).toHaveAttribute("data-lit", "true");

    // Hero chips: the static assembled position only, and pointer moves change nothing.
    const before = chipTransforms();
    expect(before).toHaveLength(4);
    for (const t of before) expect(t).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/);
    const hero = document.querySelector("[data-flow-hero]")!;
    pointer("pointerenter", hero, 10, 10);
    pointer("pointermove", hero, 1200, 700);
    pointer("pointermove", window, 4, 4);
    await flush();
    expect(chipTransforms()).toEqual(before);

    const magnets = document.querySelectorAll<HTMLElement>("[data-magnetic]");
    expect(magnets).toHaveLength(2);
    for (const magnet of magnets) expect(magnet.style.transform).toBe("");

    expect(document.querySelectorAll("[data-word]")).toHaveLength(0);
    expect(document.querySelector("[data-wordmark-line]")).toHaveAttribute("data-wordmark-line", "static");
    expect(lenis.ctor).not.toHaveBeenCalled();
  });
});

describe("M10 b: touch-only", () => {
  it("pointer moves leave chips and buttons alone; the line still draws with dots", async () => {
    installMatchMedia({ reduced: false, finePointer: false, desktop: true, wide: true });
    const added = vi.spyOn(HTMLElement.prototype, "addEventListener");
    renderLanding();
    await flush();

    expect(document.querySelector("[data-flow-line]")).toHaveAttribute("data-flow-line", "draw");
    expect(document.querySelectorAll("[data-flow-dot]")).toHaveLength(4);
    expect(document.querySelectorAll("[data-flow-node]")).toHaveLength(6);

    const hero = document.querySelector<HTMLElement>("[data-flow-hero]")!;
    // No hero pointer listener is ever attached without a fine hovering pointer.
    expect(added.mock.contexts.some((ctx, i) => ctx === hero && added.mock.calls[i]![0] === "pointermove")).toBe(false);
    vi.spyOn(hero, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1440, 900));
    const before = chipTransforms();
    expect(before).toHaveLength(4);
    pointer("pointerenter", hero, 10, 10);
    pointer("pointermove", hero, 1400, 880);
    pointer("pointermove", window, 4, 4);
    await flush(12);
    expect(chipTransforms()).toEqual(before);
    for (const magnet of document.querySelectorAll<HTMLElement>("[data-magnetic]")) {
      expect(magnet).toHaveAttribute("data-magnetic", "off");
      expect(magnet.style.transform).toBe("");
    }
  });

  it("phones get two dots and no hero chips", async () => {
    installMatchMedia({ reduced: false, finePointer: false, desktop: false, wide: false });
    renderLanding();
    await flush();
    expect(document.querySelectorAll("[data-flow-dot]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-hero-chip]")).toHaveLength(0);
  });

  it("control: with a fine pointer the chips drift with the mouse at scroll 0", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true, wide: true });
    renderLanding();
    await flush();
    const hero = document.querySelector<HTMLElement>("[data-flow-hero]")!;
    vi.spyOn(hero, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1440, 900));
    const before = chipTransforms();
    expect(before).toHaveLength(4);
    pointer("pointerenter", hero, 10, 10);
    pointer("pointermove", hero, 1400, 880);
    await flush(12);
    expect(chipTransforms()).not.toEqual(before);
  });

  it("control: with a fine pointer the button pulls toward the cursor, only while in view (RM-6)", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true, wide: true });
    io.intersecting = false;
    renderLanding();
    await flush();
    const magnets = () => Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]"));
    for (const magnet of magnets()) expect(magnet).toHaveAttribute("data-magnetic", "on");
    // Out of view: no listener, so a move inside the 24 px zone does nothing.
    pointer("pointermove", window, 12, 12);
    await flush(12);
    for (const magnet of magnets()) expect(magnet.style.transform).not.toMatch(/translate/);
    // In view: the same move pulls the button (both sit at 0,0 in happy-dom).
    await act(async () => setIntersecting(true));
    await flush(2);
    pointer("pointermove", window, 12, 12);
    await flush(12);
    expect(magnets().filter((m) => /translate/.test(m.style.transform)).length).toBeGreaterThan(0);
  });
});

function expectHeadingsIntact(container: HTMLElement) {
  for (const text of ALL_HEADINGS) {
    const heading = within(container).getByRole("heading", { name: text });
    expect(heading.textContent).toBe(text);
    expect(heading.hasAttribute("aria-label")).toBe(false);
    expect(heading.querySelectorAll("[aria-hidden]")).toHaveLength(0);
  }
}

describe("M10 c: accessible names", () => {
  it("every H1 and H2 keeps its exact name before mount (server HTML)", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <>
        <SiteHeader drawWordmark />
        <LandingPage />
        <SiteFooter />
      </>,
    );
    document.body.appendChild(container);
    expectHeadingsIntact(container);
    container.remove();
  });

  it("and after mount with motion on, while the words are split for the reveal", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true, wide: true });
    placeEverythingBelowFold();
    renderLanding();
    await flush();
    for (const text of SECTION_HEADINGS) {
      const heading = screen.getByRole("heading", { name: text });
      expect(heading.querySelectorAll("[data-word]").length, text).toBe(text.split(" ").length);
      for (const word of heading.querySelectorAll("[data-word]")) expect(word.attributes).toHaveLength(3);
    }
    // No word reveal on the hero H1 or Plans coming soon.
    expect(screen.getByRole("heading", { level: 1 }).querySelectorAll("[data-word]")).toHaveLength(0);
    expect(document.getElementById("plans")!.querySelectorAll("[data-word]")).toHaveLength(0);
    expectHeadingsIntact(document.body);
  });

  it("the header and footer wordmark links are named Flow Motion", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    renderLanding();
    for (const landmark of [screen.getByRole("banner"), screen.getByRole("contentinfo")]) {
      const link = within(landmark).getByRole("link", { name: "Flow Motion" });
      expect(link.textContent).toBe("Flow Motion");
      expect(link).toHaveAttribute("href", "/");
    }
  });
});

describe("M10 d: decorative layers", () => {
  it("are aria-hidden, hold nothing focusable, and take no pointer events", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true, wide: true });
    renderLanding();
    await flush();
    const layer = document.querySelector<HTMLElement>("[data-flow-line]")!;
    const chips = document.querySelector<HTMLElement>("[data-hero-nodes]")!;
    const handle = document.querySelector<HTMLElement>("[data-flow-output]")!;
    const wordmarkLines = Array.from(document.querySelectorAll<SVGElement>("[data-wordmark-line]"));
    expect(wordmarkLines).toHaveLength(2);
    for (const root of [layer, chips, handle, ...wordmarkLines]) {
      expect(root.getAttribute("aria-hidden")).toBe("true");
      expect(root.getAttribute("class") ?? "").toContain("pointer-events-none");
      expect(root.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
    }
    const parts = document.querySelectorAll("[data-flow-dot], [data-flow-node], [data-flow-pulse]");
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(layer.contains(part)).toBe(true);
    for (const chip of document.querySelectorAll("[data-hero-chip], [data-hero-edges]")) {
      expect(chips.contains(chip)).toBe(true);
    }
  });
});

describe("M10 e: server render", () => {
  it("has every heading as plain text and no decorative layer, word span, hidden content, or tilt", () => {
    const html = renderToString(<LandingPage />);
    for (const text of ALL_HEADINGS) expect(html).toContain(text);
    for (const marker of ["data-flow-line", "data-flow-dot", "data-flow-node", "data-hero-chip", "data-word", "data-flow-output"]) {
      expect(html).not.toContain(marker);
    }
    expect(html).not.toMatch(/data-magnetic="[^"]*"[^>]*style=/);
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toMatch(/rotateX/i);
  });

  it("after mount with motion on the flow layer appears", async () => {
    installMatchMedia({ reduced: false, finePointer: false, desktop: false });
    renderLanding();
    await flush();
    expect(document.querySelector("[data-flow-line]")).toHaveAttribute("data-flow-line", "draw");
  });
});

describe("M10 g: pulse rule (rendering)", () => {
  const nodes = ["how-it-works", "features", "security"].map((id, i) => ({ id, x: 16, y: 100 * (i + 1), s: 100 * i }));

  it("shows one pulse ring on the node that lit, and none without a pulse", () => {
    const { rerender } = render(
      <svg>
        <FlowNodes nodes={nodes} lit={[true, false, false]} pulse={{ index: 0, key: 1 }} desktop />
      </svg>,
    );
    expect(document.querySelectorAll("[data-flow-pulse]")).toHaveLength(1);
    expect(document.querySelector('[data-flow-node="how-it-works"] [data-flow-pulse]')).not.toBeNull();
    rerender(
      <svg>
        <FlowNodes nodes={nodes} lit={[true, true, true]} pulse={null} desktop />
      </svg>,
    );
    expect(document.querySelectorAll("[data-flow-pulse]")).toHaveLength(0);
    expect(document.querySelectorAll('[data-lit="true"]')).toHaveLength(3);
  });
});

describe("M5: intro settles when its node lights", () => {
  it("stays hidden below the fold, then reveals once the store lights its section", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true });
    placeEverythingBelowFold();
    // Keep the tip-line fallback quiet so only the node can trigger it.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    let store: FlowStore | null = null;
    function Capture() {
      store = useFlowStore();
      return null;
    }
    render(
      <FlowStoreProvider>
        <Capture />
        <SectionIntro id="faq" eyebrow={FAQ.eyebrow} heading={FAQ.heading} />
      </FlowStoreProvider>,
    );
    await flush();
    const words = () => Array.from(document.querySelectorAll<HTMLElement>("[data-word]"));
    expect(words().length).toBe(FAQ.heading.split(" ").length);
    expect(words()[0]!.style.opacity).toBe("0");
    act(() => store!.setLit({ faq: true }));
    await flush(40);
    expect(words()[0]!.style.opacity).not.toBe("0");
    // Once: unlighting (scrolling up) keeps it revealed.
    act(() => store!.setLit({ faq: false }));
    await flush();
    expect(words().length).toBe(FAQ.heading.split(" ").length);
    expect(words()[0]!.style.opacity).not.toBe("0");
  });
});

describe("M10 i: legal pages", () => {
  it("render no flow layer and a static wordmark line, even with motion on", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true, wide: true });
    for (const Page of [PrivacyPage, TermsPage]) {
      const { unmount } = render(
        <>
          <Page />
          <SiteFooter />
        </>,
      );
      await flush(2);
      expect(document.querySelector("[data-flow-line]")).toBeNull();
      expect(document.querySelector("[data-hero-chip]")).toBeNull();
      const lines = document.querySelectorAll("[data-wordmark-line]");
      expect(lines.length).toBe(2);
      for (const line of lines) expect(line).toHaveAttribute("data-wordmark-line", "static");
      unmount();
    }
  });

  it("on the landing page only the header line draws; the footer line is static", () => {
    installMatchMedia({ reduced: false, finePointer: true });
    renderLanding();
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Flow Motion" }).querySelector("[data-wordmark-line]")).toHaveAttribute(
      "data-wordmark-line",
      "draw",
    );
    expect(
      within(screen.getByRole("contentinfo")).getByRole("link", { name: "Flow Motion" }).querySelector("[data-wordmark-line]"),
    ).toHaveAttribute("data-wordmark-line", "static");
  });
});

describe("Review fixes", () => {
  it("RL-1: the server HTML already has the desktop story structure, unchanged after hydration", async () => {
    const html = renderToString(<LandingPage />);
    expect(html).toContain('data-story-visual="sticky"');
    expect(html).toContain("md:motion-safe:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]");
    const container = document.createElement("div");
    container.innerHTML = html;
    const serverSteps = Array.from(container.querySelectorAll("#how-it-works [data-story-step]"));
    expect(serverSteps).toHaveLength(4);
    for (const step of serverSteps) expect(step.getAttribute("class")).toContain("md:motion-safe:min-h-[70vh]");

    installMatchMedia({ reduced: false, finePointer: true, desktop: true });
    renderLanding();
    await flush();
    const section = document.getElementById("how-it-works")!;
    expect(section).toHaveAttribute("data-story-layout", "sticky");
    const clientSteps = Array.from(section.querySelectorAll("[data-story-step]"));
    expect(clientSteps.map((s) => s.getAttribute("class"))).toEqual(serverSteps.map((s) => s.getAttribute("class")));
    expect(section.querySelector("[data-story-visual]")!.parentElement!.getAttribute("class")).toBe(
      container.querySelector("#how-it-works [data-story-visual]")!.parentElement!.getAttribute("class"),
    );
  });

  it("RL-2: panels and cards already on screen never go blank after hydration", async () => {
    installMatchMedia({ reduced: false, finePointer: false, desktop: false });
    renderLanding();
    await flush();
    const animated = document.querySelectorAll<HTMLElement>("[data-story-step], [data-reveal]");
    expect(animated.length).toBeGreaterThanOrEqual(8);
    for (const el of animated) expect(el.style.opacity).not.toBe("0");
  });

  it("RL-2: only elements below the fold start hidden", async () => {
    installMatchMedia({ reduced: false, finePointer: false, desktop: false });
    placeEverythingBelowFold();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    renderLanding();
    await flush();
    const cards = document.querySelectorAll<HTMLElement>("[data-reveal]");
    expect(cards.length).toBe(4);
    for (const card of cards) expect(card.style.opacity).toBe("0");
  });

  it("RM-3: the hero frame is flat at load and tilts in 3D only as the hero scrolls past, reversibly", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true });
    renderLanding();
    await flush(10);
    const frame = () => document.querySelector<HTMLElement>("[data-hero-frame]")!;
    expect(frame().style.transform).not.toMatch(/rotateX\((?!0)/);
    await act(async () => scroll.progress!.set(0.8));
    await flush(3);
    expect(frame().style.transform).toMatch(/rotateX\([1-9]/);
    expect(frame().style.transform).toMatch(/scale\(0\.9/);
    await act(async () => scroll.progress!.set(0));
    await flush(3);
    expect(frame().style.transform).not.toMatch(/rotateX\((?!0)/);
  });

  it("RM-3: no tilt under reduced motion", async () => {
    installMatchMedia({ reduced: true, finePointer: true, desktop: true });
    renderLanding();
    await act(async () => scroll.progress!.set(0.8));
    await flush(3);
    expect(document.querySelector("[data-hero-frame]")).toBeNull();
  });

  it("RM-1: the features grid and its cards cannot widen the page on phones", () => {
    installMatchMedia({ reduced: true });
    renderLanding();
    const grid = document.querySelector("#features [data-reveal]")!.parentElement!;
    expect(grid.className).toMatch(/(^| )grid-cols-1( |$)/);
    for (const card of document.querySelectorAll("#features [data-reveal]")) expect(card.className).toContain("min-w-0");
    expect(document.querySelector("[data-preview='feature-export'] pre")!.className).toContain("max-w-full");
    // Same min-content guard on the other phone grids (hero preview, story panels).
    expect(document.querySelector("[data-preview='hero-analysis'] .grid")!.className).toMatch(/(^| )grid-cols-1( |$)/);
    for (const step of document.querySelectorAll("#how-it-works [data-story-step]")) {
      expect(step.className).toMatch(/(^| )grid-cols-1( |$)/);
    }
  });

  it("RM-4: the desktop story draws no step line beside the flow line", async () => {
    installMatchMedia({ reduced: false, finePointer: true, desktop: true });
    renderLanding();
    await flush();
    const steps = document.querySelectorAll("#how-it-works [data-story-step]");
    expect(steps).toHaveLength(4);
    for (const step of steps) expect(step.querySelectorAll(":scope > span.bg-primary, :scope > span.bg-grid")).toHaveLength(0);
  });
});
