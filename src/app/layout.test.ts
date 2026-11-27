import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Root layout scroll behavior: the CSS keeps `scroll-behavior: smooth`, so
 * `<html>` must carry `data-scroll-behavior="smooth"` for Next.js to turn
 * smooth scrolling off during route transitions (and to stop warning).
 */

const APP = join(process.cwd(), "src/app");

function read(name: string): string {
  return readFileSync(join(APP, name), "utf8");
}

describe("root layout scroll behavior", () => {
  it("marks smooth scroll on <html> for Next.js route transitions", () => {
    const html = read("layout.tsx").match(/<html\b[^>]*>/)?.[0];
    expect(html).toBeDefined();
    expect(html).toContain('data-scroll-behavior="smooth"');
  });

  it("keeps the global smooth scroll rule and the Lenis override", () => {
    const css = read("globals.css");
    expect(css).toContain("scroll-behavior: smooth;");
    expect(css).toMatch(/html\.lenis\s*\{[^}]*scroll-behavior:\s*auto;/);
  });
});
