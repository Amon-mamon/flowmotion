/**
 * Path policy (docs/security.md section 1, contract section 11 Phase 2 item 3).
 *
 * Runs BEFORE any fetch. Order: deny list, then extension allowlist, then the
 * size cap. Pure and runtime-neutral. The only exception to the deny list is
 * a file whose basename is exactly `.env.example` (case-sensitive).
 */

export type PathBlockReason = "denied" | "extension" | "size";
export type PathDecision = { allowed: true } | { allowed: false; reason: PathBlockReason };

/** 200 KB per file. */
export const MAX_FILE_BYTES = 204_800;

export const ENV_EXAMPLE_BASENAME = ".env.example";

/**
 * Deny globs matched case-insensitively against EVERY path segment, so a
 * denied directory name denies everything under it. `*` matches any run of
 * characters (including none) inside one segment.
 */
export const DENY_SEGMENT_GLOBS: readonly string[] = [
  // env files (exception handled separately)
  ".env",
  ".env.*",
  // keys and keystores
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa*",
  "id_ed25519*",
  "*.ppk",
  // credential files
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  // D-31 / S2-7: well-known credential files with allowlisted extensions
  ".yarnrc.yml",
  "auth.json",
  "credentials.json",
  ".htpasswd",
  ".pgpass",
  "wp-config.php",
  "*.p8",
  // credential directories
  ".aws",
  ".ssh",
  ".gcloud",
  ".kube",
  // broad name globs (also block ordinary files on purpose)
  "*credentials*",
  "*secret*",
  "*secrets*",
  "service-account*.json",
  // infrastructure state
  "*.tfstate",
  "*.tfstate.backup",
  "terraform.tfvars",
  "*.tfvars",
  // data dumps
  "*.sqlite",
  "*.db",
  "*.dump",
  // vcs and dependencies
  ".git",
  "node_modules",
  // lockfiles
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  // build and vendor output
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  // generated assets
  "*.min.js",
  "*.map",
];

/** Multi-segment deny sequences (matched case-insensitively anywhere in the path). */
export const DENY_SEGMENT_SEQUENCES: readonly (readonly string[])[] = [[".docker", "config.json"]];

/** Extension allowlist (lowercase, with dot). */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
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
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".prisma",
  ".sql",
  ".graphql",
  ".gql",
  ".html",
  ".md",
  ".csproj",
]);

/** Exact basenames allowed without an allowlisted extension (case-sensitive). */
export const ALLOWED_BASENAMES: ReadonlySet<string> = new Set([
  "Dockerfile",
  "Procfile",
  "Gemfile",
  ENV_EXAMPLE_BASENAME,
]);

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

const DENY_REGEXPS: readonly RegExp[] = DENY_SEGMENT_GLOBS.map(globToRegExp);

/**
 * Normalises a repository path: `\` → `/`, leading `./` and `/` stripped,
 * `.` and `..` resolved. Returns null when the path escapes the root or is
 * empty.
 */
export function normalizeRepoPath(path: string): string | null {
  const segments = path.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.length === 0 ? null : out.join("/");
}

export function basenameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** Lowercase extension including the dot, or "" when none. A leading dot alone is not an extension. */
export function extensionOf(basename: string): string {
  const index = basename.lastIndexOf(".");
  if (index <= 0) return "";
  return basename.slice(index).toLowerCase();
}

function isDeniedSegment(segment: string, isBasename: boolean): boolean {
  // The single exception: basename exactly `.env.example` (case-sensitive).
  if (isBasename && segment === ENV_EXAMPLE_BASENAME) return false;
  return DENY_REGEXPS.some((regexp) => regexp.test(segment));
}

function hasDeniedSequence(segments: readonly string[]): boolean {
  const lower = segments.map((segment) => segment.toLowerCase());
  return DENY_SEGMENT_SEQUENCES.some((sequence) => {
    for (let start = 0; start + sequence.length <= lower.length; start += 1) {
      if (sequence.every((part, offset) => lower[start + offset] === part.toLowerCase())) return true;
    }
    return false;
  });
}

/** True when the normalised path hits the deny list (no extension or size check). */
export function isDeniedPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  if (normalized === null) return true;
  const segments = normalized.split("/");
  const last = segments.length - 1;
  if (segments.some((segment, index) => isDeniedSegment(segment, index === last))) return true;
  return hasDeniedSequence(segments);
}

function hasAllowedExtension(basename: string): boolean {
  if (ALLOWED_BASENAMES.has(basename)) return true;
  return ALLOWED_EXTENSIONS.has(extensionOf(basename));
}

/**
 * Classifies one repository path. Deny first, then extension allowlist, then
 * size (`size > 204800` → `size`). A path escaping the root is `denied`.
 */
export function classifyPath(path: string, size: number): PathDecision {
  const normalized = normalizeRepoPath(path);
  if (normalized === null || isDeniedPath(normalized)) return { allowed: false, reason: "denied" };
  if (!hasAllowedExtension(basenameOf(normalized))) return { allowed: false, reason: "extension" };
  if (size > MAX_FILE_BYTES) return { allowed: false, reason: "size" };
  return { allowed: true };
}
