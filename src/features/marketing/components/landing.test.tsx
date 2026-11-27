import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lenis = vi.hoisted(() => ({ ctor: vi.fn(), scrollTo: vi.fn(), destroy: vi.fn() }));
const readiness = vi.hoisted(() => ({ live: false }));

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
vi.mock("@/features/marketing/readiness", () => ({ isFlowGenerationLive: () => readiness.live }));

import { scan } from "@/lib/security/secret-scanner";
import {
  COMING_SOON,
  FACTS,
  FAQ,
  FEATURES,
  FINAL_CTA,
  FOOTER,
  HEADER,
  HERO,
  HOW_IT_WORKS,
  SECURITY,
} from "@/features/marketing/copy";
import { PLANS_BODY, PLANS_HEADING } from "@/features/marketing/components/plans-coming-soon";
import { LandingPage } from "@/features/marketing/components/landing-page";
import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";
import { PREVIEW_FINDING, PREVIEW_REPO } from "@/features/marketing/preview-data";
import { installMatchMedia } from "@/features/marketing/test-media";

/** The "Landing page" section of docs/design.md, the source of truth for copy. */
const DESIGN = (() => {
  const text = readFileSync(join(process.cwd(), "docs/design.md"), "utf8");
  const start = text.indexOf("## Landing page");
  const end = text.indexOf("\n## App", start);
  return text.slice(start, end);
})();

/** Asserts each string appears quoted, verbatim, in design.md's landing section. */
function expectInDesign(strings: readonly string[]) {
  for (const s of strings) expect(DESIGN, s).toContain(`"${s}"`);
}

function renderPage() {
  return render(
    <>
      <SiteHeader />
      <main>
        <LandingPage />
      </main>
      <SiteFooter />
    </>,
  );
}

function pageText() {
  return document.body.textContent ?? "";
}

function expectRendered(strings: readonly string[]) {
  const text = pageText();
  for (const s of strings) expect(text, s).toContain(s);
}

beforeEach(() => {
  readiness.live = false;
  lenis.ctor.mockClear();
  lenis.scrollTo.mockClear();
  lenis.destroy.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe("Landing page copy (exact, from design.md)", () => {
  beforeEach(() => installMatchMedia({ reduced: true }));

  it("header labels and hrefs", () => {
    expectInDesign([...HEADER.nav.map((n) => n.label), HEADER.login.label, HEADER.getStarted.label]);
    expect(HEADER.nav.map((n) => `#${n.anchor}`)).toEqual(["#how-it-works", "#security", "#faq"]);
    expect(HEADER.navLabel).toBe("Main");
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how-it-works");
    expect(within(nav).getByRole("link", { name: "Security" })).toHaveAttribute("href", "#security");
    expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "#faq");
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(within(banner).getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
  });

  it("hero heading, lead, tag, and buttons", () => {
    expect(HERO.heading).toBe("Turn your repository into working n8n automations.");
    expect(HERO.lead).toBe(
      "Flow Motion reads your code safely, finds what to automate, and builds the workflows for you.",
    );
    expectInDesign([HERO.tag, HERO.heading, HERO.lead, HERO.primary.label, HERO.secondary.label]);
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HERO.heading);
    expectRendered([HERO.tag, HERO.lead]);
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
  });

  it("the four fact strip labels", () => {
    expect(FACTS.map((f) => f.label)).toEqual([
      "Reads only safe files",
      "Secrets masked before any AI call",
      "32 supported n8n nodes",
      "Exports n8n-ready JSON",
    ]);
    expectInDesign(FACTS.map((f) => f.label));
    renderPage();
    expectRendered(FACTS.map((f) => f.label));
  });

  it("how it works: intro and four step labels, titles, and bodies", () => {
    expectInDesign([HOW_IT_WORKS.eyebrow, HOW_IT_WORKS.heading, HOW_IT_WORKS.lead]);
    expect(HOW_IT_WORKS.steps.map((s) => s.label)).toEqual([
      "01 / Connect",
      "02 / Scan",
      "03 / Recommend",
      "04 / Generate",
    ]);
    expectInDesign(HOW_IT_WORKS.steps.flatMap((s) => [s.label, s.title, s.body]));
    renderPage();
    expectRendered([HOW_IT_WORKS.heading, HOW_IT_WORKS.lead]);
    for (const step of HOW_IT_WORKS.steps) {
      expect(screen.getByRole("heading", { level: 3, name: new RegExp(step.title) })).toBeInTheDocument();
      expectRendered([step.label, step.body]);
    }
  });

  it("features: intro and four card titles and bodies", () => {
    const cards = [FEATURES.graphs, FEATURES.findings, FEATURES.recommendations, FEATURES.export];
    expectInDesign([FEATURES.eyebrow, FEATURES.heading, FEATURES.lead, ...cards.flatMap((c) => [c.title, c.body])]);
    renderPage();
    for (const card of cards) {
      expect(screen.getByRole("heading", { level: 3, name: card.title })).toBeInTheDocument();
      expectRendered([card.body]);
    }
  });

  it("security: intro, five guarantees, link, and the example finding", () => {
    expect(SECURITY.guarantees).toHaveLength(5);
    expectInDesign([
      SECURITY.eyebrow,
      SECURITY.heading,
      SECURITY.lead,
      SECURITY.privacyLink.label,
      ...SECURITY.guarantees.flatMap((g) => [g.title, g.body]),
    ]);
    expect(PREVIEW_FINDING.location).toBe("src/lib/payments.ts:14");
    expect(PREVIEW_FINDING.maskedEvidence).toBe("sk…2a");
    expectInDesign([PREVIEW_FINDING.remediation, PREVIEW_FINDING.category, SECURITY.exampleTag]);
    renderPage();
    for (const g of SECURITY.guarantees) {
      expect(screen.getByRole("heading", { level: 3, name: g.title })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Read the privacy page" })).toHaveAttribute("href", "/privacy");
  });

  it("FAQ: eight questions and answers", () => {
    expect(FAQ.items).toHaveLength(8);
    expectInDesign([FAQ.eyebrow, FAQ.heading, ...FAQ.items.flatMap((i) => [i.q, i.a])]);
    renderPage();
    const faq = document.getElementById("faq")!;
    expect(faq.querySelectorAll("details")).toHaveLength(8);
    for (const item of FAQ.items) {
      expect(within(faq).getByText(item.q)).toBeInTheDocument();
      expect(within(faq).getByText(item.a)).toBeInTheDocument();
    }
  });

  it("final call to action", () => {
    expectInDesign([FINAL_CTA.heading, FINAL_CTA.body, FINAL_CTA.primary.label, FINAL_CTA.secondary.label]);
    renderPage();
    const cta = document.getElementById("get-started")!;
    expect(within(cta).getByRole("heading", { level: 2 })).toHaveTextContent(FINAL_CTA.heading);
    expect(within(cta).getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    expect(within(cta).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expectRendered([FINAL_CTA.body]);
  });

  it("footer lines and links", () => {
    expectInDesign([FOOTER.tagline, FOOTER.disclaimer, ...FOOTER.links.map((l) => l.label)]);
    renderPage();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(FOOTER.tagline)).toBeInTheDocument();
    expect(within(footer).getByText(FOOTER.disclaimer)).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});

describe("Landing page structure", () => {
  beforeEach(() => installMatchMedia({ reduced: true }));

  it("shows the exact Plans coming soon copy and nothing else there", () => {
    renderPage();
    expect(PLANS_HEADING).toBe("Plans coming soon");
    expect(PLANS_BODY).toBe(
      "Flow Motion is in early testing. There are no paid plans, prices, or credits yet. Pricing will be announced here before anything changes.",
    );
    const section = document.getElementById("plans")!;
    expect(section.querySelector("h2")?.textContent).toBe(PLANS_HEADING);
    expect(section.textContent).toBe(PLANS_HEADING + PLANS_BODY);
    expect(section.querySelectorAll("a, button, [data-coming-soon]")).toHaveLength(0);
  });

  it("has one h1, labelled sections with scroll margin, and each section id once", () => {
    renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const id of ["how-it-works", "features", "security", "plans", "faq", "get-started"]) {
      const matches = document.querySelectorAll(`[id="${id}"]`);
      expect(matches, id).toHaveLength(1);
      const section = matches[0]!;
      expect(section.tagName).toBe("SECTION");
      expect(section.className).toContain("scroll-mt-20");
      const heading = document.getElementById(section.getAttribute("aria-labelledby") ?? "");
      expect(heading?.tagName, id).toBe("H2");
      expect(heading).toHaveAttribute("tabindex", "-1");
    }
  });

  it("contains no forbidden content, images, or quotes", () => {
    renderPage();
    expect(pageText()).not.toMatch(
      /testimonial|trusted by|customers|users love|\b\d[\d,.]*\+?\s*(users|teams|companies|developers)\b|★|\$\d|€\d|£\d|checkout|guaranteed|100%|simulat/i,
    );
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.querySelectorAll("blockquote")).toHaveLength(0);
  });

  it("shows exactly four Coming soon tags, on the four places from F1", () => {
    renderPage();
    const tags = Array.from(document.body.querySelectorAll("*")).filter(
      (el) => el.textContent === COMING_SOON,
    );
    expect(tags).toHaveLength(4);
    expect(document.querySelectorAll("[data-coming-soon]")).toHaveLength(4);
    const places = tags.map((tag) => {
      const step = tag.closest("[data-story-step]");
      if (step) return `step:${step.getAttribute("data-story-step")}`;
      const card = tag.closest("article");
      if (card) return `card:${card.querySelector("h3")?.textContent}`;
      return `fact:${tag.closest("li")?.textContent?.replace(COMING_SOON, "")}`;
    });
    expect(places.sort()).toEqual(
      ["card:Readable node graphs", "card:n8n JSON export", "fact:Exports n8n-ready JSON", "step:generate"].sort(),
    );
  });

  it("drops every Coming soon tag once flow generation is live", () => {
    readiness.live = true;
    renderPage();
    expect(document.querySelectorAll("[data-coming-soon]")).toHaveLength(0);
  });
});

describe("Product previews", () => {
  beforeEach(() => installMatchMedia({ reduced: true }));

  it("are aria-hidden, inert, and hold no link, button, or input", () => {
    renderPage();
    const previews = document.querySelectorAll("[data-preview]");
    // hero, four steps, four feature visuals, security finding
    expect(previews.length).toBeGreaterThanOrEqual(10);
    for (const preview of previews) {
      const name = preview.getAttribute("data-preview");
      expect(preview, name ?? "").toHaveAttribute("aria-hidden", "true");
      expect(preview.hasAttribute("inert"), name ?? "").toBe(true);
      expect(preview.querySelectorAll("a, button, input, select, textarea, [tabindex]"), name ?? "").toHaveLength(0);
    }
  });

  it("use sample data only: example repo and masked evidence, nothing key-shaped", () => {
    renderPage();
    const text = Array.from(document.querySelectorAll("[data-preview]"))
      .map((p) => p.textContent ?? "")
      .join("\n");
    expect(text).toContain(PREVIEW_REPO);
    expect(text).toContain("sk…2a");
    expect(scan("landing-preview.ts", text).findings).toEqual([]);
    expect(text).not.toMatch(/\bsk[-_][A-Za-z0-9]{6,}/);
  });
});

describe("Server render", () => {
  it("renders every section, step, and card fully visible with no transform", () => {
    const html = renderToString(<LandingPage />);
    for (const id of ["how-it-works", "features", "security", "plans", "faq", "get-started"]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const step of HOW_IT_WORKS.steps) expect(html).toContain(step.title);
    for (const card of [FEATURES.graphs, FEATURES.findings, FEATURES.recommendations, FEATURES.export]) {
      expect(html).toContain(card.title);
    }
    expect(html).toContain('data-story-layout="stacked"');
    expect(html).toContain('data-reveal="static"');
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toMatch(/rotateX/i);
    expect(html).not.toContain("data-hero-frame");
  });
});
