import { checkFlowSpec } from "@/lib/flowspec/check";
import { GENERATE_MAX_FEEDBACK, type FeedbackEntry } from "@/lib/jobs/types";
import { NODE_KEY_PATTERN, flowSpecDraftSchema, type FlowSpec } from "@/schemas/flowspec";

/**
 * Model output parsing for the generation `ai` step (contract section 4,
 * D-59). Model text is untrusted: it is length-capped before anything scans
 * it, the first JSON object is cut out by a linear brace scan, then Zod, the
 * `sourceFiles` filter, and `checkFlowSpec`. Failures carry our rule ids only
 * (never model text). Nothing here logs.
 */

/** 256 KB: longer response text is refused before any JSON scan or `JSON.parse` (feedback F12). */
export const MAX_RESPONSE_CHARS = 262_144;

export type ParseFlowSpecResult =
  | { ok: true; spec: FlowSpec }
  | { ok: false; reason: "empty_content" | "invalid_output"; feedback: FeedbackEntry[] };

const fail = (
  reason: "empty_content" | "invalid_output",
  feedback: FeedbackEntry[],
): ParseFlowSpecResult => ({ ok: false, reason, feedback: dedupeFeedback(feedback) });

/** Deduplicated, at most 20 entries, order kept. */
export function dedupeFeedback(entries: readonly FeedbackEntry[]): FeedbackEntry[] {
  const seen = new Set<string>();
  const out: FeedbackEntry[] = [];
  for (const entry of entries) {
    const id = `${entry.rule}:${entry.nodeKey ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
    if (out.length >= GENERATE_MAX_FEEDBACK) break;
  }
  return out;
}

/**
 * The first balanced `{ … }` starting at `from`, string- and escape-aware.
 * Linear in the text length. Null when the braces never balance.
 */
function balancedObjectAt(text: string, from: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

/** The first JSON object in the text (code fences tolerated), or null. */
export function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const first = objectFrom(text);
  if (first !== null) return first;
  // Prose with a stray brace before a fenced answer: try the first fence's content.
  const fenced = /```(?:json)?[ \t]*\n([\s\S]*?)```/i.exec(text);
  return fenced?.[1] === undefined ? null : objectFrom(fenced[1]);
}

function objectFrom(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  const candidate = balancedObjectAt(text, start);
  if (candidate === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** Removes `sourceFiles` entries not in the allowed set (raw draft, before Zod). */
function filterSourceFiles(raw: Record<string, unknown>, allowed: ReadonlySet<string>): Record<string, unknown> {
  const nodes = raw.nodes;
  if (!Array.isArray(nodes)) return raw;
  return {
    ...raw,
    nodes: nodes.map((node: unknown) => {
      if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
      const record = node as Record<string, unknown>;
      if (!Object.hasOwn(record, "sourceFiles") || !Array.isArray(record.sourceFiles)) return record;
      const kept = [
        ...new Set(record.sourceFiles.filter((path): path is string => typeof path === "string" && allowed.has(path))),
      ];
      return { ...record, sourceFiles: kept };
    }),
  };
}

/** The node key of `nodes[i]` when the Zod issue points into a node and the key is well formed. */
function issueNodeKey(raw: Record<string, unknown>, path: readonly PropertyKey[]): string | undefined {
  if (path[0] !== "nodes" || typeof path[1] !== "number") return undefined;
  const nodes = raw.nodes;
  if (!Array.isArray(nodes)) return undefined;
  const node: unknown = nodes[path[1]];
  if (node === null || typeof node !== "object") return undefined;
  const key = (node as Record<string, unknown>).key;
  return typeof key === "string" && NODE_KEY_PATTERN.test(key) ? key : undefined;
}

/**
 * Parses model text into a checked FlowSpec. Order (D-59): length cap first
 * (no scan, no `JSON.parse` on over-long text), empty check, first JSON
 * object, sourceFiles filter, Zod, then `checkFlowSpec`.
 */
export function parseFlowSpecDraft(text: string, allowedSourceFiles: readonly string[]): ParseFlowSpecResult {
  if (text.length > MAX_RESPONSE_CHARS) return fail("invalid_output", [{ rule: "F12" }]);
  if (text.trim() === "") return fail("empty_content", [{ rule: "EMPTY" }]);

  const raw = extractFirstJsonObject(text);
  if (raw === null) return fail("invalid_output", [{ rule: "NO_JSON" }]);

  const candidate = filterSourceFiles(raw, new Set(allowedSourceFiles));
  const parsed = flowSpecDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    const entries: FeedbackEntry[] = parsed.error.issues.map((issue) => {
      const nodeKey = issueNodeKey(candidate, issue.path);
      return nodeKey === undefined ? { rule: "SCHEMA" } : { rule: "SCHEMA", nodeKey };
    });
    return fail("invalid_output", entries.length > 0 ? entries : [{ rule: "SCHEMA" }]);
  }

  const checked = checkFlowSpec(parsed.data);
  if (!checked.ok) {
    return fail(
      "invalid_output",
      checked.errors.map((error) =>
        error.nodeKey !== undefined && NODE_KEY_PATTERN.test(error.nodeKey)
          ? { rule: error.rule, nodeKey: error.nodeKey }
          : { rule: error.rule },
      ),
    );
  }
  return { ok: true, spec: checked.spec };
}
