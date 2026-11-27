// @vitest-environment node
/**
 * R3a-9 (D-59): `importVerified` is imported only by src/server/flows/view.ts,
 * never by src/lib/jobs/**, src/lib/generation/**, or supabase/functions/**.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
  }
  return out;
}

/** An import (static or dynamic) of the module that holds `importVerified`. */
const IMPORTS_VERIFIED = /["'][^"'\n]*n8n-catalog\/import-verified(?:\.[a-z]+)?["']/;
/** The bare function name in code (comments and the DTO field `importVerified:` aside). */
const CALLS_VERIFIED = /\bimportVerified\s*\(/;

describe("R3a-9 import rule", () => {
  it("only src/server/flows/view.ts uses importVerified among app code", () => {
    const users = [...files(join(ROOT, "src")), ...files(join(ROOT, "supabase", "functions"))]
      .filter((path) => IMPORTS_VERIFIED.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path).split("\\").join("/"))
      .filter((path) => path !== "src/lib/n8n-catalog/import-verified.ts");
    expect(users).toEqual(["src/server/flows/view.ts"]);
  });

  it("no file under src/lib/jobs, src/lib/generation, or supabase/functions mentions it", () => {
    for (const dir of [["src", "lib", "jobs"], ["src", "lib", "generation"], ["supabase", "functions"]]) {
      for (const path of files(join(ROOT, ...dir))) {
        const text = readFileSync(path, "utf8");
        expect(text).not.toMatch(IMPORTS_VERIFIED);
        expect(text).not.toMatch(CALLS_VERIFIED);
      }
    }
  });
});
