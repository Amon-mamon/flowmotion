import { isManifestPath } from "@/lib/analysis/validity";
import { classifyPath, ENV_EXAMPLE_BASENAME, normalizeRepoPath } from "@/lib/security/path-policy";
import type { BlockedByReason } from "@/schemas/analysis";

/**
 * File selection (contract section 4 step 2, Phase 2 item 6). Pure and
 * deterministic: classify every blob, order allowed files by tier, depth and
 * path, keep the first 400.
 */

export const MAX_SELECTED_FILES = 400;

export interface TreeBlob {
  path: string;
  sha: string;
  size: number;
}

export interface SelectionCounts extends BlockedByReason {
  /** All blobs in the tree. */
  considered: number;
}

export interface Selection {
  selected: TreeBlob[];
  counts: SelectionCounts;
  /** Paths denied by the policy (for path-only findings; never fetched). */
  deniedPaths: string[];
}

const TIER3_SEGMENT =
  /^(api|routes?|controllers?|handlers?|webhooks?|hooks|jobs?|workers?|queues?|cron|tasks?|functions|actions)$/i;
const TIER3_BASENAMES: ReadonlySet<string> = new Set(["urls.py", "routes.rb", "web.php", "api.php"]);

function stem(basename: string): string {
  const index = basename.indexOf(".");
  return index <= 0 ? basename : basename.slice(0, index);
}

/** Priority tier 1 (highest) to 6. */
export function tierOf(path: string): number {
  const segments = path.split("/");
  const base = segments[segments.length - 1] ?? "";
  const lower = path.toLowerCase();
  const lowerBase = base.toLowerCase();

  if (isManifestPath(path) || base === ENV_EXAMPLE_BASENAME) return 1;

  if (
    /^\.github\/workflows\/[^/]+$/.test(path) ||
    base === "vercel.json" ||
    base === "netlify.toml" ||
    base === "Dockerfile" ||
    /^docker-compose[^/]*\.ya?ml$/i.test(base) ||
    base === "Procfile" ||
    lower.startsWith("supabase/functions/")
  ) {
    return 2;
  }

  const dirs = segments.slice(0, -1);
  if (
    dirs.some((segment) => TIER3_SEGMENT.test(segment)) ||
    TIER3_SEGMENT.test(stem(base)) ||
    /^route\.(ts|js)$/.test(base) ||
    /(^|\/)pages\/api\//.test(path) ||
    TIER3_BASENAMES.has(base)
  ) {
    return 3;
  }

  if (
    lowerBase.endsWith(".prisma") ||
    /(^|\/)migrations\/[^/]+\.sql$/i.test(path) ||
    /^schema\./i.test(base) ||
    dirs.some((segment) => segment.toLowerCase() === "models") ||
    lowerBase.endsWith(".graphql")
  ) {
    return 4;
  }

  if (path.toLowerCase() === "readme.md") return 5;
  return 6;
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Classifies and orders the tree's blobs. */
export function selectFiles(blobs: readonly TreeBlob[], max: number = MAX_SELECTED_FILES): Selection {
  const counts: SelectionCounts = { considered: blobs.length, denied: 0, extension: 0, size: 0, cap: 0 };
  const allowed: { blob: TreeBlob; tier: number; depth: number }[] = [];
  const deniedPaths: string[] = [];

  for (const blob of blobs) {
    const decision = classifyPath(blob.path, blob.size);
    if (!decision.allowed) {
      counts[decision.reason] += 1;
      if (decision.reason === "denied") deniedPaths.push(blob.path);
      continue;
    }
    const normalized = normalizeRepoPath(blob.path) ?? blob.path;
    allowed.push({
      blob: { ...blob, path: normalized },
      tier: tierOf(normalized),
      depth: normalized.split("/").length,
    });
  }

  allowed.sort(
    (a, b) => a.tier - b.tier || a.depth - b.depth || comparePaths(a.blob.path, b.blob.path),
  );
  const selected = allowed.slice(0, max).map((entry) => entry.blob);
  counts.cap = Math.max(0, allowed.length - max);
  return { selected, counts, deniedPaths };
}

export function blockedTotal(counts: BlockedByReason): number {
  return counts.denied + counts.extension + counts.size + counts.cap;
}
