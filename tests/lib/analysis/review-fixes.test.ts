// @vitest-environment node
/** Phase 2 review fixes: S2-3 (extractor/scanner cost), S2-4 (manifest size), S2-7 (deny list). */
import { describe, expect, it } from "vitest";

import { extractSignals } from "@/lib/analysis/extractors";
import { extractEnvVars } from "@/lib/analysis/extractors/env-var";
import { lineOf } from "@/lib/analysis/extractors/util";
import { pickManifestPaths } from "@/lib/analysis/validity";
import { classifyPath } from "@/lib/security/path-policy";
import { PATH_ONLY_EVIDENCE, pathOnlyFinding, scan } from "@/lib/security/secret-scanner";

describe("S2-3: extractor and scanner cost on large crafted files", () => {
  // The reviewer's shape: one ~200 KB file with 10,000 `process.env.X` lines.
  const crafted = Array.from({ length: 10_000 }, (_, i) => `process.env.V${i}`).join("\n");

  it("crafted file is ~200 KB", () => {
    expect(crafted.length).toBeGreaterThan(150_000);
    expect(crafted.length).toBeLessThanOrEqual(204_800);
  });

  it("10,000 matches finish well under 1 s and yield at most 500 signals from one extractor", () => {
    const started = performance.now();
    const env = extractEnvVars({ path: "src/env.ts", text: crafted });
    const all = extractSignals({ path: "src/env.ts", text: crafted });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(env.length).toBeLessThanOrEqual(500);
    expect(all.filter((s) => s.kind === "env_var").length).toBeLessThanOrEqual(500);
  });

  it("line numbers stay exact with the cached index", () => {
    expect(lineOf("a\nb\nc", 0)).toBe(1);
    expect(lineOf("a\nb\nc", 2)).toBe(2);
    expect(lineOf("a\nb\nc", 4)).toBe(3);
    expect(lineOf("x", 0)).toBe(1);
    const env = extractEnvVars({ path: "a.ts", text: "\n\nprocess.env.ABC" });
    expect(env[0]?.line).toBe(3);
  });

  it("the scanner stays linear on long identifier runs and many assignments", () => {
    const longRun = "x".repeat(200_000);
    const assignments = Array.from({ length: 5_000 }, (_, i) => `postmark_key_${i} = value${i}`).join("\n");
    const started = performance.now();
    scan("src/a.ts", longRun);
    scan("config.yml", assignments);
    scan(".env.example", crafted);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("S2-4: manifest size cap", () => {
  it("drops manifests over 200 KB, including extension-less ones", () => {
    const picked = pickManifestPaths([
      { path: "requirements.txt", size: 300_000 },
      { path: "go.mod", size: 204_801 },
      { path: "package.json", size: 204_800 },
      { path: "pom.xml", size: 10 },
    ]);
    expect(picked).toEqual(["package.json", "pom.xml"]);
  });
});

describe("S2-7 / D-31: deny list additions", () => {
  it.each([
    ".yarnrc.yml",
    "auth.json",
    ".composer/auth.json",
    "locales/en/auth.json",
    "credentials.json",
    ".htpasswd",
    ".pgpass",
    "wp-config.php",
    "AuthKey_ABC123.p8",
    "sub/dir/.YARNRC.YML",
    "public/AUTH.JSON",
    "site/WP-CONFIG.PHP",
    "keys/apple.P8",
  ])("%s is denied", (path) => {
    expect(classifyPath(path, 10)).toEqual({ allowed: false, reason: "denied" });
  });

  it.each([
    [".yarnrc.yml", "hardcoded_secret"],
    ["credentials.json", "hardcoded_secret"],
    [".htpasswd", "hardcoded_secret"],
    ["wp-config.php", "hardcoded_secret"],
    ["auth.json", "hardcoded_secret"],
    [".composer/auth.json", "hardcoded_secret"],
    [".pgpass", "db_connection_string"],
    ["keys/AuthKey_ABC.p8", "private_key"],
  ])("%s → path-only %s", (path, category) => {
    expect(pathOnlyFinding(path)).toMatchObject({ category, line: null, maskedEvidence: PATH_ONLY_EVIDENCE });
  });

  it("auth.json elsewhere is denied with no finding", () => {
    expect(classifyPath("locales/en/auth.json", 10).allowed).toBe(false);
    expect(pathOnlyFinding("locales/en/auth.json")).toBeNull();
  });
});
