import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * OC-8: the Phase 3a Generate gate is gone for good. Scans source and test
 * files alike (this file is skipped because it names what it forbids).
 */
const ROOT = process.cwd();
const SELF = join(ROOT, "src/features/flows/readiness-removed.test.ts");
const GATE_MODULE = "@/features/flows/readiness";
const GATE_HINT = "Flow generation is being set up.";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) || path === SELF) return [];
    return [path];
  });
}

describe("Generate gate removed (OC-8)", () => {
  it("the gate module no longer exists", () => {
    expect(existsSync(join(ROOT, "src/features/flows/readiness.ts"))).toBe(false);
  });

  it(`no file under src/ imports ${GATE_MODULE}`, () => {
    const offenders = files(join(ROOT, "src"))
      .filter((path) => readFileSync(path, "utf8").includes(GATE_MODULE))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("the set-up hint appears nowhere under src/features/", () => {
    const offenders = files(join(ROOT, "src/features"))
      .filter((path) => readFileSync(path, "utf8").includes(GATE_HINT))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
