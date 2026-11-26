import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contract Phase 2e-ui item 5(i), D-54: the integrations feature and its page use no
 * storage, network, console, query cache, or cookie API. Test files are excluded
 * because they name these APIs to spy on them.
 */
const ROOT = process.cwd();
const FEATURE_DIR = join(ROOT, "src/features/integrations");
const PAGE_FILE = join(ROOT, "src/app/(app)/integrations/page.tsx");
const FORBIDDEN = [
  "localStorage",
  "sessionStorage",
  "fetch(",
  "console.",
  "useQuery",
  "useMutation",
  "document.cookie",
  // Also no other storage, network, store, or URL channel.
  "indexedDB",
  "sendBeacon",
  "XMLHttpRequest",
  "WebSocket",
  "zustand",
  "useSearchParams",
  "@tanstack/react-query",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

/** Pattern checks (R2eu-2): bare `fetch` identifier (not "prefetch"), server actions, cookie store, navigator. */
const FORBIDDEN_PATTERNS: [string, RegExp][] = [
  ["fetch identifier", /(?<![A-Za-z0-9_$])fetch(?![A-Za-z0-9_$])/],
  ["use server directive", /(["'`])use server\1/],
  ["cookieStore", /cookieStore/],
  ["navigator.", /(?<![A-Za-z0-9_$])navigator\s*\./],
];

const files = [...sourceFiles(FEATURE_DIR), PAGE_FILE];

describe("integrations source check", () => {
  it("finds the feature files and the page", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain(PAGE_FILE);
  });

  it.each(files.map((f) => relative(ROOT, f)))("%s uses no forbidden API", (file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const word of FORBIDDEN) {
      expect(text.includes(word), `${file} contains ${word}`).toBe(false);
    }
  });

  it("the pattern checks catch what they should and skip lookalikes", () => {
    const [, fetchRe] = FORBIDDEN_PATTERNS[0]!;
    expect(fetchRe.test("const f = fetch;")).toBe(true);
    expect(fetchRe.test("globalThis.fetch")).toBe(true);
    expect(fetchRe.test("router.prefetch(href)")).toBe(false);
    expect(fetchRe.test("nothing is fetched")).toBe(false);
    expect(fetchRe.test("refetch()")).toBe(false);
    expect(FORBIDDEN_PATTERNS[1]![1].test(`"use server";`)).toBe(true);
    expect(FORBIDDEN_PATTERNS[1]![1].test(`'use server'`)).toBe(true);
    expect(FORBIDDEN_PATTERNS[3]![1].test("navigator.clipboard")).toBe(true);
  });

  it.each(files.map((f) => relative(ROOT, f)))("%s matches no forbidden pattern", (file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [name, pattern] of FORBIDDEN_PATTERNS) {
      expect(pattern.test(text), `${file} contains ${name}`).toBe(false);
    }
  });

  it("the key input is never registered, read, or given a change handler", () => {
    const form = readFileSync(join(FEATURE_DIR, "components/ai-provider-form.tsx"), "utf8");
    expect(form).not.toMatch(/keyInputRef\.current\??\.value(?!\s*=\s*"")/);
    expect(form).not.toMatch(/register\(\s*"apiKey"/);
    expect(form).not.toMatch(/apiKey/);
    expect(form).not.toMatch(/new FormData|sendBeacon|XMLHttpRequest|indexedDB|useSearchParams|router\./);
    const keyInput = form.slice(form.indexOf("ref={keyInputRef}"), form.indexOf("/>", form.indexOf("ref={keyInputRef}")));
    expect(keyInput).toContain('type="password"');
    expect(keyInput).not.toMatch(/onChange|onInput|value=|defaultValue|name=|\{\.\.\./);
  });
});
