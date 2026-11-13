import type { Signal, SignalKind } from "@/schemas/analysis";

/** One file as seen by the extractors: path plus REDACTED text. */
export interface ExtractorFile {
  path: string;
  text: string;
}

export type Extractor = (file: ExtractorFile) => Signal[];

export const MAX_LABEL_LENGTH = 120;

/** Matches kept per regexp and per extractor in one file (S2-3). */
export const MAX_MATCHES_PER_EXTRACTOR = 500;

// Line starts of the file being processed, computed once per text (S2-3).
let cachedText: string | null = null;
let cachedStarts: number[] = [0];

function lineStartsOf(text: string): number[] {
  if (cachedText === text) return cachedStarts;
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  cachedText = text;
  cachedStarts = starts;
  return starts;
}

/** 1-based line of a character index (binary search over cached line starts). */
export function lineOf(text: string, index: number): number {
  const starts = lineStartsOf(text);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Plain-text label: control characters removed, whitespace collapsed, max 120 chars. */
export function cleanLabel(label: string): string {
  return (
    label
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_LABEL_LENGTH)
  );
}

export function signal(
  kind: SignalKind,
  file: ExtractorFile,
  index: number | null,
  label: string,
): Signal | null {
  const clean = cleanLabel(label);
  if (clean === "") return null;
  return {
    kind,
    filePath: file.path,
    line: index === null ? null : lineOf(file.text, index),
    label: clean,
  };
}

/** Runs a regexp globally and maps each match; nulls are dropped. */
export function collect(
  regexp: RegExp,
  text: string,
  map: (match: RegExpExecArray) => Signal | null,
): Signal[] {
  const out: Signal[] = [];
  const flags = regexp.flags.includes("g") ? regexp.flags : `${regexp.flags}g`;
  const re = new RegExp(regexp.source, flags);
  let match: RegExpExecArray | null;
  let matches = 0;
  while ((match = re.exec(text)) !== null) {
    matches += 1;
    if (matches > MAX_MATCHES_PER_EXTRACTOR) break;
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const result = map(match);
    if (result !== null) out.push(result);
  }
  return out;
}

export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

export function extension(path: string): string {
  const base = basename(path);
  const index = base.lastIndexOf(".");
  return index <= 0 ? "" : base.slice(index).toLowerCase();
}

export function isWorkflowFile(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}

export function notNull<T>(value: T | null): value is T {
  return value !== null;
}
