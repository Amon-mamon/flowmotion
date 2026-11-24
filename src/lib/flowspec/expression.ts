/**
 * The expression subset (docs/contract.md section 7). The only grammar a
 * generated flow may use; anything else fails rule F8 and validator rule 6.
 *
 *   expr    := operand ( cmp operand )?
 *   operand := ref | string | number | "true" | "false" | "null"
 *   ref     := "$json" path | "$node[" string "].json" path
 *   path    := ( "." FieldName | "[" string "]" | "[" integer "]" ){1,6}
 *   cmp     := "==" | "!=" | ">" | ">=" | "<" | "<="
 *   string  := single- or double-quoted, at most 100 chars, no quotes,
 *              backslashes, or line breaks inside
 *
 * Hand-written single-pass scanner: every character is visited a bounded
 * number of times, so parsing is linear in the input length. No regular
 * expression with backtracking is used. Pure and runtime-neutral.
 */

export const MAX_PATH_SEGMENTS = 6;
export const MAX_STRING_LENGTH = 100;
export const MAX_FIELD_NAME_LENGTH = 64;
const MAX_NUMBER_LENGTH = 20;
const MAX_INDEX_DIGITS = 6;

/** Property names that reach an object's prototype; never allowed in a path. */
const FORBIDDEN_PROPERTIES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export type TemplateSegment =
  | { kind: "literal"; text: string }
  | { kind: "expression"; text: string /* including the braces */; nodeRefs: string[] };

export type TemplateResult =
  | { ok: true; hasExpression: boolean; segments: TemplateSegment[]; nodeRefs: string[] }
  | { ok: false };

export type ExpressionResult = { ok: true; nodeRefs: string[] } | { ok: false };

function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 10;
}

class Scanner {
  pos = 0;
  readonly nodeRefs: string[] = [];

  constructor(readonly source: string) {}

  skipSpaces(): void {
    while (this.pos < this.source.length && isSpace(this.source.charCodeAt(this.pos))) this.pos += 1;
  }

  take(literal: string): boolean {
    if (this.source.startsWith(literal, this.pos)) {
      this.pos += literal.length;
      return true;
    }
    return false;
  }

  /** A quoted string; returns its content or null. */
  string(): string | null {
    const quote = this.source[this.pos];
    if (quote !== '"' && quote !== "'") return null;
    const start = this.pos + 1;
    let end = start;
    while (end < this.source.length && end - start <= MAX_STRING_LENGTH) {
      const char = this.source[end];
      if (char === '"' || char === "'") break;
      if (char === "\\" || char === "\n" || char === "\r") return null;
      end += 1;
    }
    if (end >= this.source.length || this.source[end] !== quote) return null;
    if (end - start > MAX_STRING_LENGTH) return null;
    this.pos = end + 1;
    return this.source.slice(start, end);
  }

  fieldName(): string | null {
    const start = this.pos;
    if (start >= this.source.length || !isAlpha(this.source.charCodeAt(start))) return null;
    let end = start + 1;
    while (end < this.source.length && end - start <= MAX_FIELD_NAME_LENGTH) {
      const code = this.source.charCodeAt(end);
      if (!isAlpha(code) && !isDigit(code)) break;
      end += 1;
    }
    if (end - start > MAX_FIELD_NAME_LENGTH) return null;
    this.pos = end;
    return this.source.slice(start, end);
  }

  digits(max: number): boolean {
    const start = this.pos;
    let end = start;
    while (end < this.source.length && end - start <= max && isDigit(this.source.charCodeAt(end))) end += 1;
    if (end === start || end - start > max) return false;
    this.pos = end;
    return true;
  }

  path(): boolean {
    let segments = 0;
    for (;;) {
      const char = this.source[this.pos];
      if (char === ".") {
        this.pos += 1;
        const name = this.fieldName();
        if (name === null || FORBIDDEN_PROPERTIES.has(name)) return false;
      } else if (char === "[") {
        this.pos += 1;
        const next = this.source[this.pos];
        if (next === '"' || next === "'") {
          const key = this.string();
          if (key === null || FORBIDDEN_PROPERTIES.has(key)) return false;
        } else if (!this.digits(MAX_INDEX_DIGITS)) {
          return false;
        }
        if (!this.take("]")) return false;
      } else {
        break;
      }
      segments += 1;
      if (segments > MAX_PATH_SEGMENTS) return false;
    }
    return segments >= 1;
  }

  /** Ends an operand: the next character must not continue an identifier or a call. */
  boundary(): boolean {
    if (this.pos >= this.source.length) return true;
    const code = this.source.charCodeAt(this.pos);
    return !isAlpha(code) && !isDigit(code) && code !== 36 /* $ */ && code !== 40 /* ( */ && code !== 46 /* . */;
  }

  operand(): boolean {
    if (this.take("$json")) return this.path() && this.boundary();
    if (this.take("$node[")) {
      const label = this.string();
      if (label === null) return false;
      if (!this.take("].json")) return false;
      if (!this.path() || !this.boundary()) return false;
      this.nodeRefs.push(label);
      return true;
    }
    const char = this.source[this.pos];
    if (char === '"' || char === "'") return this.string() !== null && this.boundary();
    if (this.take("true") || this.take("false") || this.take("null")) return this.boundary();
    // number := "-"? digits ( "." digits )?
    const start = this.pos;
    if (this.source[this.pos] === "-") this.pos += 1;
    if (!this.digits(MAX_NUMBER_LENGTH)) return false;
    if (this.source[this.pos] === ".") {
      this.pos += 1;
      if (!this.digits(MAX_NUMBER_LENGTH)) return false;
    }
    return this.pos - start <= MAX_NUMBER_LENGTH && this.boundary();
  }

  comparator(): boolean {
    return (
      this.take("==") || this.take("!=") || this.take(">=") || this.take("<=") || this.take(">") || this.take("<")
    );
  }
}

/** Parses the text between `{{` and `}}`. */
export function parseExpression(source: string): ExpressionResult {
  const scanner = new Scanner(source);
  scanner.skipSpaces();
  if (!scanner.operand()) return { ok: false };
  scanner.skipSpaces();
  if (scanner.pos < source.length) {
    if (!scanner.comparator()) return { ok: false };
    scanner.skipSpaces();
    if (!scanner.operand()) return { ok: false };
    scanner.skipSpaces();
  }
  if (scanner.pos !== source.length) return { ok: false };
  return { ok: true, nodeRefs: scanner.nodeRefs };
}

/**
 * Parses a text that may hold `{{ … }}` expressions. Fails on an unbalanced
 * `{{` or `}}`, on nesting, and on any expression outside the grammar.
 */
export function parseTemplate(text: string): TemplateResult {
  const segments: TemplateSegment[] = [];
  const nodeRefs: string[] = [];
  let pos = 0;
  let hasExpression = false;
  while (pos < text.length) {
    const open = text.indexOf("{{", pos);
    if (open === -1) {
      // The rest is literal: a stray `}}` is unbalanced.
      if (text.indexOf("}}", pos) !== -1) return { ok: false };
      segments.push({ kind: "literal", text: text.slice(pos) });
      break;
    }
    const strayClose = text.indexOf("}}", pos);
    if (strayClose !== -1 && strayClose < open) return { ok: false };
    const close = text.indexOf("}}", open + 2);
    if (close === -1) return { ok: false };
    const inner = text.slice(open + 2, close);
    if (inner.includes("{{")) return { ok: false };
    const parsed = parseExpression(inner);
    if (!parsed.ok) return { ok: false };
    if (open > pos) segments.push({ kind: "literal", text: text.slice(pos, open) });
    segments.push({ kind: "expression", text: text.slice(open, close + 2), nodeRefs: parsed.nodeRefs });
    nodeRefs.push(...parsed.nodeRefs);
    hasExpression = true;
    pos = close + 2;
  }
  return { ok: true, hasExpression, segments, nodeRefs };
}
