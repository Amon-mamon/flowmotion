import { MAX_FILE_BYTES, basenameOf, classifyPath, extensionOf, normalizeRepoPath } from "@/lib/security/path-policy";
import type { ValidationResult } from "@/schemas/analysis";

/**
 * Project validity check (contract section 4 step 1, Phase 2 item 5). Pure:
 * takes the tree paths plus the text of a few manifests, fetched by the
 * worker. Manifest text is parsed in memory and never stored or logged.
 */

export const MAX_MANIFESTS = 15;
/** Directory depth of a manifest (root = 0). */
export const MAX_MANIFEST_DEPTH = 3;

export const INVALID_REASONS = {
  empty: "The repository is empty.",
  docsOnly: "The repository only contains documentation.",
  noSource: "No source code was found.",
  noFramework:
    "No website or app framework was found. Flow Motion supports web and mobile app projects.",
} as const;

export const MANIFEST_BASENAMES: ReadonlySet<string> = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

export function isManifestPath(path: string): boolean {
  const base = basenameOf(path);
  return MANIFEST_BASENAMES.has(base) || base.toLowerCase().endsWith(".csproj");
}

function depthOf(path: string): number {
  return path.split("/").length - 1;
}

/**
 * Up to 15 manifest paths at depth ≤ 3 that are not denied by the path
 * policy (shallowest first, then by path). Size is checked by the caller with
 * the tree's blob size.
 */
export function pickManifestPaths(entries: readonly { path: string; size: number }[]): string[] {
  return entries
    .filter((entry) => isManifestPath(entry.path) && depthOf(entry.path) <= MAX_MANIFEST_DEPTH)
    .filter((entry) => {
      // requirements.txt, Pipfile, pom.xml, go.mod, build.gradle have no
      // allowlisted extension; only the deny list and size cap apply here.
      // S2-4: the size cap applies to manifests too (extension-less ones included).
      if (entry.size > MAX_FILE_BYTES) return false;
      const decision = classifyPath(entry.path, entry.size);
      return decision.allowed || decision.reason === "extension";
    })
    .map((entry) => entry.path)
    .sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_MANIFESTS);
}

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".php",
  ".go",
  ".java",
  ".kt",
  ".cs",
  ".dart",
  ".prisma",
  ".sql",
  ".graphql",
  ".gql",
  ".html",
]);

const DOC_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".txt", ".rst"]);
const LICENSE_BASENAME = /^(licen[cs]e|copying|notice|authors)(\..*)?$/i;

type Kind = "website" | "app";

const WEBSITE_PACKAGES = new Set([
  "next",
  "react",
  "react-dom",
  "vue",
  "svelte",
  "@sveltejs/kit",
  "nuxt",
  "astro",
  "@angular/core",
]);
/** Website markers that stay websites even next to a mobile marker. */
const STRONG_WEB_PACKAGES = new Set(["next", "vue", "svelte", "@sveltejs/kit", "nuxt", "astro", "@angular/core"]);
const MOBILE_PACKAGES = new Set(["react-native", "expo"]);
const SERVER_PACKAGES = new Set(["express", "fastify", "@nestjs/core", "hono", "koa"]);

function packageJsonKind(text: string): Kind | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = record[field];
    if (typeof deps === "object" && deps !== null && !Array.isArray(deps)) {
      for (const name of Object.keys(deps)) names.add(name);
    }
  }
  const has = (set: ReadonlySet<string>) => [...names].some((name) => set.has(name));
  const remix = [...names].some((name) => name.startsWith("@remix-run/"));
  const mobile = has(MOBILE_PACKAGES);
  if (mobile && !has(STRONG_WEB_PACKAGES) && !remix) return "app";
  if (has(WEBSITE_PACKAGES) || remix) return "website";
  if (has(SERVER_PACKAGES)) return "app";
  return null;
}

function pythonPackageRegExp(name: string): RegExp {
  return new RegExp(`(^|[\\s"'\\[,])${name}([\\s"'<>=~!\\[;,]|$)`, "im");
}

function pythonKind(text: string): Kind | null {
  if (pythonPackageRegExp("django").test(text)) return "website";
  if (pythonPackageRegExp("flask").test(text) || pythonPackageRegExp("fastapi").test(text)) return "app";
  return null;
}

function composerKind(text: string): Kind | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    for (const field of ["require", "require-dev"]) {
      const deps = record[field];
      if (typeof deps === "object" && deps !== null && "laravel/framework" in deps) return "website";
    }
  } catch {
    return null;
  }
  return null;
}

function manifestKind(path: string, text: string): Kind | null {
  const base = basenameOf(path);
  switch (base) {
    case "package.json":
      return packageJsonKind(text);
    case "requirements.txt":
    case "pyproject.toml":
    case "Pipfile":
      return pythonKind(text);
    case "Gemfile":
      return /^\s*gem\s+["']rails["']/m.test(text) ? "website" : null;
    case "composer.json":
      return composerKind(text);
    case "pubspec.yaml":
      return /^\s*flutter\s*:/m.test(text) ? "app" : null;
    case "go.mod":
      return /github\.com\/(gin-gonic\/gin|labstack\/echo|gofiber\/fiber|go-chi\/chi)\b/.test(text) ? "app" : null;
    case "pom.xml":
    case "build.gradle":
    case "build.gradle.kts":
      return /spring-boot/.test(text) ? "app" : null;
    default:
      if (base.toLowerCase().endsWith(".csproj")) {
        return /Microsoft\.NET\.Sdk\.Web/.test(text) ? "app" : null;
      }
      return null;
  }
}

function hasStaticSiteMarker(paths: readonly string[]): boolean {
  const index = paths.some((path) => ["index.html", "public/index.html", "src/index.html"].includes(path));
  if (!index) return false;
  return paths.some((path) => {
    const ext = extensionOf(basenameOf(path));
    return ext === ".js" || ext === ".css";
  });
}

function isDocPath(path: string): boolean {
  if (path.startsWith("docs/")) return true;
  const base = basenameOf(path);
  return DOC_EXTENSIONS.has(extensionOf(base)) || LICENSE_BASENAME.test(base);
}

function isDotPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Decides whether the repository is a website or app project.
 * `manifests` maps manifest path → text (only those fetched by the worker).
 */
export function checkValidity(
  blobPaths: readonly string[],
  manifests: ReadonlyMap<string, string>,
): ValidationResult {
  const paths = blobPaths
    .map((path) => normalizeRepoPath(path))
    .filter((path): path is string => path !== null);
  if (paths.length === 0) return { kind: "invalid", reason: INVALID_REASONS.empty };

  const nonDot = paths.filter((path) => !isDotPath(path));
  if (nonDot.length > 0 && nonDot.every(isDocPath) && nonDot.some((path) => !LICENSE_BASENAME.test(basenameOf(path)))) {
    return { kind: "invalid", reason: INVALID_REASONS.docsOnly };
  }

  const hasSource = paths.some((path) => {
    const decision = classifyPath(path, 0);
    if (!decision.allowed && decision.reason === "denied") return false;
    return SOURCE_EXTENSIONS.has(extensionOf(basenameOf(path)));
  });
  if (!hasSource) return { kind: "invalid", reason: INVALID_REASONS.noSource };

  let found: Kind | null = null;
  for (const [path, text] of manifests) {
    const kind = manifestKind(path, text);
    if (kind === "website") {
      found = "website";
      break;
    }
    if (kind === "app") found = "app";
  }
  if (found === null && hasStaticSiteMarker(paths)) found = "website";
  if (found === null) return { kind: "invalid", reason: INVALID_REASONS.noFramework };
  return { kind: found, reason: null };
}
