import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source-level rules for the landing page (contract section 11, Landing
 * redesign F10, F11, F12 g and j).
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");
const SOURCE_FILES = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f));

/** Module specifiers of static imports, re-exports, and dynamic imports. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*from\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) specs.push(m[1]!);
  return specs;
}

/** Type-only imports are erased, so they never reach the bundle. */
function runtimeImportsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(/\bimport\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g)) specs.push(m[1]!);
  for (const m of text.matchAll(/\bexport\s+(?!type\s)(?:\*|\{[^}]*\})\s*from\s+["']([^"']+)["']/g)) specs.push(m[1]!);
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const isLenis = (spec: string) => spec === "lenis" || spec.startsWith("lenis/");
const isSmoothScroll = (spec: string) => /(^|\/)smooth-scroll$/.test(spec);

const BANNED = [
  (s: string) => s === "@xyflow/react" || s.startsWith("@xyflow/"),
  (s: string) => s === "@tanstack/react-query" || s.startsWith("@tanstack/react-query/"),
  (s: string) => s === "@/lib/supabase" || s.startsWith("@/lib/supabase/"),
  (s: string) => /(^|\/)queries$/.test(s),
  (s: string) => s === "framer-motion" || s.startsWith("framer-motion/"),
];

describe("Lenis scope (D-56)", () => {
  it("only smooth-scroll.tsx imports lenis, and nothing imports lenis/react", () => {
    const importers = SOURCE_FILES.filter((f) => importsOf(f).some(isLenis)).map(rel);
    expect(importers).toEqual(["src/features/marketing/components/smooth-scroll.tsx"]);
    const reactImporters = SOURCE_FILES.filter((f) => importsOf(f).includes("lenis/react"));
    expect(reactImporters).toEqual([]);
  });

  it("only the landing page imports smooth-scroll", () => {
    const importers = SOURCE_FILES.filter((f) => importsOf(f).some(isSmoothScroll)).map(rel);
    expect(importers).toEqual(["src/features/marketing/components/landing-page.tsx"]);
  });

  it("no app, auth, layout, privacy, or terms file imports lenis or smooth-scroll", () => {
    const guarded = SOURCE_FILES.filter((f) => {
      const p = rel(f);
      return (
        p.startsWith("src/app/(app)/") ||
        p.startsWith("src/app/(auth)/") ||
        /(^|\/)layout\.tsx$/.test(p) ||
        p.includes("/privacy/") ||
        p.includes("/terms/")
      );
    });
    expect(guarded.length).toBeGreaterThan(0);
    for (const file of guarded) {
      const offending = importsOf(file).filter((s) => isLenis(s) || isSmoothScroll(s));
      expect(offending, rel(file)).toEqual([]);
    }
  });
});

describe("Landing bundle rule (F10)", () => {
  it("no file under src/features/marketing or src/app/(marketing) imports a banned module", () => {
    const files = SOURCE_FILES.filter((f) => {
      const p = rel(f);
      return p.startsWith("src/features/marketing/") || p.startsWith("src/app/(marketing)/");
    });
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const offending = importsOf(file).filter((s) => BANNED.some((ban) => ban(s)));
      expect(offending, rel(file)).toEqual([]);
    }
  });

  it("nothing the landing route loads at runtime pulls a banned module in transitively", () => {
    const entry = join(SRC, "app/(marketing)/page.tsx");
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of runtimeImportsOf(file)) {
        expect(BANNED.some((ban) => ban(spec)), `${rel(file)} imports ${spec}`).toBe(false);
        const local = resolveLocal(file, spec);
        if (local !== null) queue.push(local);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});
