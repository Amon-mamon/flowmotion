import type { FindingCategory, Severity } from "@/schemas/analysis";
import { basenameOf, ENV_EXAMPLE_BASENAME, normalizeRepoPath } from "@/lib/security/path-policy";

/**
 * Secret scanner (docs/security.md sections 2 and 6, contract section 11
 * Phase 2 item 4). Pure and runtime-neutral: no logging, no I/O. Raw matched
 * values never leave this module: findings carry masked evidence only and the
 * returned text has every secret match replaced by `[REDACTED]`.
 */

export const REDACTED = "[REDACTED]";
export const MAX_FINDINGS_PER_ANALYSIS = 200;
export const PATH_ONLY_EVIDENCE = "file present (not opened)";

export interface MaskedFinding {
  category: FindingCategory;
  severity: Severity;
  filePath: string;
  /** 1-based; null for path-only findings. */
  line: number | null;
  maskedEvidence: string;
  remediation: string;
}

export interface ScanResult {
  findings: MaskedFinding[];
  redacted: string;
}

export const CATEGORY_SEVERITY: Readonly<Record<FindingCategory, Severity>> = {
  committed_env_file: "high",
  hardcoded_secret: "high",
  private_key: "high",
  cloud_credentials: "high",
  service_account: "high",
  db_connection_string: "high",
  jwt_signing_secret: "high",
  webhook_secret_url: "medium",
  ci_secret: "high",
  client_exposed_secret: "high",
  debug_config: "low",
};

export const REMEDIATION: Readonly<Record<FindingCategory, string>> = {
  committed_env_file:
    "Remove the env file from the repository, add it to .gitignore, and rotate every value it contained.",
  hardcoded_secret:
    "Rotate this credential and load it from an environment variable or a secret manager instead of the code.",
  private_key:
    "Revoke and replace this private key, remove it from the repository, and store it in a secret manager.",
  cloud_credentials:
    "Rotate these cloud credentials and provide them through environment variables or the platform's secret store.",
  service_account:
    "Disable this service account key, create a new one, and keep it out of the repository.",
  db_connection_string:
    "Change the database password and read the connection string from an environment variable.",
  jwt_signing_secret:
    "Rotate this token or signing secret and load it from an environment variable.",
  webhook_secret_url:
    "Regenerate this webhook URL and keep it in an environment variable, since anyone with it can post messages.",
  ci_secret:
    "Rotate this secret and reference it through your CI provider's encrypted secrets instead of the file.",
  client_exposed_secret:
    "Never expose secret or service-role keys through public (browser) variables; move them to server-only code and rotate them.",
  debug_config:
    "Turn debug mode off for production and control it with an environment variable.",
};

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { high: 3, medium: 2, low: 1 };

// --- masking -------------------------------------------------------------------

/**
 * `"<type>: <first 2>…<last 2>"`, or `"<type>"` alone when the value is under
 * 12 characters. Never more than 4 characters of the value.
 */
export function maskEvidence(type: string, value: string): string {
  if (value.length < 12) return type;
  return `${type}: ${value.slice(0, 2)}…${value.slice(-2)}`;
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function decodeBase64UrlJson(segment: string): unknown {
  try {
    const padded =
      segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/** True for the public Supabase anon key (payload `"role":"anon"`). */
export function isAnonJwt(token: string): boolean {
  const payload = token.split(".")[1];
  if (payload === undefined) return false;
  const decoded = decodeBase64UrlJson(payload);
  return (
    typeof decoded === "object" &&
    decoded !== null &&
    (decoded as Record<string, unknown>).role === "anon"
  );
}

// --- patterns -------------------------------------------------------------------

interface RawMatch {
  start: number;
  end: number;
  category: FindingCategory;
  /** Evidence type label shown to the user. */
  type: string;
  /** Value used for masking (never stored). */
  value: string;
  /** Whether the span is replaced by [REDACTED]. */
  redact: boolean;
  /** Fixed evidence text for non-secret findings (names, debug flags). */
  evidence?: string;
  /** Lower runs first when spans overlap. */
  priority: number;
  /** Provider patterns: the literal prefix skipped by the repeated-character check (D-33). */
  placeholderPrefix?: string;
}

interface Detector {
  name: string;
  regexp: RegExp;
  /** Limits the detector to some files (e.g. config files for unquoted values). */
  appliesTo?: (path: string) => boolean;
  build(match: RegExpExecArray): RawMatch | null;
}

function spanOf(match: RegExpExecArray, group: number): { start: number; end: number; value: string } | null {
  const value = match[group];
  if (value === undefined) return null;
  const whole = match[0];
  const offset = whole.indexOf(value);
  if (offset === -1) return null;
  const start = match.index + offset;
  return { start, end: start + value.length, value };
}

/** Names whose assigned value is treated as a secret (D-28, D-34: quoted and unquoted). */
export const SECRET_NAME = /(?:key|token|secret|password|passwd|pwd|passphrase|credential|auth)|_pass$/i;
/**
 * Password-type names (D-34 / R2b-1): a quoted value may contain spaces and
 * tabs (never a line break or a quote character) and runs to its closing quote.
 */
export const PASSWORD_TYPE_NAME = /(?:password|passwd|pwd|passphrase|secret)|_pass$/i;
const JWT_SECRET_NAME = /(jwt|session)/i;
const PUBLIC_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_)/;

/** `changeme`, `example`, or a run of 3+ `x`, as a whole word (bounded by a non-alphanumeric or the ends). */
const PLACEHOLDER_WORD = /(?<![A-Za-z0-9])(?:changeme|example|x{3,})(?![A-Za-z0-9])/i;
const BARE_VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;

export interface PlaceholderOptions {
  /** Generic assignment rule only: skip bare variable names (D-33). */
  bareName?: boolean;
  /** Provider patterns: literal prefix to skip for the repeated-character check (D-33). */
  prefix?: string;
}

/**
 * Shared placeholder rule (security.md section 2, D-28, amended by D-33 /
 * S2R-1): empty, `your-` / `your_` prefix, `changeme` / `example` / `xxx` as a
 * whole word, wrapped in `<…>`, a `${…}` / `{{…}}` / `$NAME` reference, or one
 * repeated character (for a provider pattern, after its literal prefix). The
 * bare-variable-name rule applies to the generic assignment rule only and
 * requires a `_` plus (length < 20 or entropy < 3.5), so uppercase keys and
 * base32 seeds are not skipped.
 */
export function isPlaceholderValue(value: string, options: PlaceholderOptions = {}): boolean {
  const v = value.trim();
  if (v === "") return true;
  if (/^your[-_]/i.test(v)) return true;
  if (PLACEHOLDER_WORD.test(v)) return true;
  if (/^<.*>$/.test(v)) return true;
  if (v.includes("${") || v.includes("{{") || v.startsWith("$")) return true;
  if (/^(.)\1*$/.test(v)) return true;
  if (options.prefix !== undefined && v.startsWith(options.prefix)) {
    const rest = v.slice(options.prefix.length);
    if (rest.length > 0 && /^(.)\1*$/.test(rest)) return true;
    // D-34 (e) / R2b-6: also skip an optional `v<digits>-` segment (`sk-or-v1-000…`).
    const unversioned = rest.replace(/^v\d+-/, "");
    if (unversioned !== rest && unversioned.length > 0 && /^(.)\1*$/.test(unversioned)) return true;
  }
  // A short letter prefix followed by one repeated character (`SK000…`, `key-000…`).
  const body = v.replace(/^[A-Za-z]{1,12}[-_.]?/, "");
  if (body.length >= 8 && /^(.)\1*$/.test(body)) return true;
  if (
    options.bareName === true &&
    BARE_VARIABLE_NAME.test(v) &&
    v.includes("_") &&
    (v.length < 20 || shannonEntropy(v) < 3.5)
  ) {
    return true;
  }
  return false;
}

/** Files where an unquoted `NAME=VALUE` / `NAME: VALUE` is a literal (D-28). */
export function isUnquotedConfigFile(path: string): boolean {
  const normalized = normalizeRepoPath(path) ?? path;
  const base = basenameOf(normalized);
  if (base === ENV_EXAMPLE_BASENAME || base === "Dockerfile" || base === "Procfile") return true;
  if (/\.(?:ya?ml|toml)$/i.test(base)) return true;
  if (/^\.github\/workflows\//.test(normalized) || normalized.includes("/.github/workflows/")) return true;
  return false;
}

function isDockerfile(path: string): boolean {
  const base = basenameOf(normalizeRepoPath(path) ?? path).toLowerCase();
  return base === "dockerfile" || base.startsWith("dockerfile.") || base.endsWith(".dockerfile");
}

/** True for the Supabase service-role JWT (payload `"role":"service_role"`). */
export function isServiceRoleJwt(token: string): boolean {
  const payload = token.split(".")[1];
  if (payload === undefined) return false;
  const decoded = decodeBase64UrlJson(payload);
  return (
    typeof decoded === "object" &&
    decoded !== null &&
    (decoded as Record<string, unknown>).role === "service_role"
  );
}

/** Provider key shapes, for the generic rule's "or matches a provider pattern". */
const PROVIDER_VALUE_PATTERNS: readonly RegExp[] = [
  /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  /^sk-or-[A-Za-z0-9_-]{32,}$/,
  /^sk-(?!ant-|or-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}$/,
  /^SG\.[A-Za-z0-9_-]{16,32}\.[A-Za-z0-9_-]{30,64}$/,
  /^npm_[A-Za-z0-9]{36}$/,
  /^glpat-[A-Za-z0-9_-]{20,}$/,
  /^sb_secret_[A-Za-z0-9_-]{20,}$/,
  /^SK[0-9a-fA-F]{32}$/,
  /^key-[0-9a-f]{32}$/,
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}$/,
  /^(?:sk_live|rk_live|sk_test)_[A-Za-z0-9]{10,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}$/,
];

/** Base32-shaped values such as TOTP seeds match without entropy (D-33). */
const BASE32_VALUE = /^[A-Z2-7]{16,}={0,6}$/;

function isSecretLikeValue(value: string): boolean {
  if (value.length >= 20 && shannonEntropy(value) >= 3.5) return true;
  if (BASE32_VALUE.test(value) && /[2-7]/.test(value)) return true;
  return PROVIDER_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function genericCategory(name: string): FindingCategory {
  if (PUBLIC_PREFIX.test(name)) return "client_exposed_secret";
  return JWT_SECRET_NAME.test(name) ? "jwt_signing_secret" : "hardcoded_secret";
}

/** Literal prefixes of provider key shapes, for the generic rule's placeholder check. */
const PROVIDER_PLACEHOLDER_PREFIXES: readonly string[] = [
  "sk-ant-",
  "sk-or-",
  "sk-",
  "SG.",
  "npm_",
  "glpat-",
  "sb_secret_",
  "re_",
];

/** A provider-shaped value whose body (after the prefix) is a placeholder (D-33, D-34 (e)). */
function isProviderPlaceholder(value: string): boolean {
  const v = value.trim();
  return PROVIDER_PLACEHOLDER_PREFIXES.some(
    (prefix) => v.startsWith(prefix) && isPlaceholderValue(v, { prefix }),
  );
}

function genericMatch(
  m: RegExpExecArray,
  nameGroup: number,
  valueGroup: number,
  options: { requireWhitespace?: boolean } = {},
): RawMatch | null {
  const name = m[nameGroup];
  const value = m[valueGroup];
  if (name === undefined || value === undefined) return null;
  if (!SECRET_NAME.test(name)) return null;
  if (options.requireWhitespace === true) {
    // D-34 (a): spaces and tabs are allowed only for password-type names; a
    // value without whitespace is left to the plain quoted rule.
    if (!PASSWORD_TYPE_NAME.test(name)) return null;
    if (!/[ \t]/.test(value)) return null;
  }
  if (isPlaceholderValue(value, { bareName: true })) return null;
  if (isProviderPlaceholder(value)) return null;
  if (!isSecretLikeValue(value)) return null;
  const start = m.index + m[0].lastIndexOf(value);
  return {
    start,
    end: start + value.length,
    value,
    category: genericCategory(name),
    type: "high-entropy secret",
    redact: true,
    priority: 2,
  };
}

function provider(
  type: string,
  regexp: RegExp,
  options: { prefix?: string; extra?: (value: string) => boolean } = {},
): Detector {
  return {
    name: type,
    regexp,
    build: (m) => {
      const span = spanOf(m, 1);
      if (span === null) return null;
      if (options.extra !== undefined && !options.extra(span.value)) return null;
      return {
        ...span,
        category: "hardcoded_secret",
        type,
        redact: true,
        priority: 1,
        ...(options.prefix !== undefined ? { placeholderPrefix: options.prefix } : {}),
      };
    },
  };
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const DETECTORS: readonly Detector[] = [
  {
    name: "private key block",
    regexp:
      /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/g,
    build: (m) => ({
      start: m.index,
      end: m.index + m[0].length,
      category: "private_key",
      type: "private key block",
      value: "",
      redact: true,
      evidence: "private key block",
      priority: 0,
    }),
  },
  {
    name: "AWS access key id",
    regexp: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "cloud_credentials", type: "AWS access key id", redact: true, priority: 1 };
    },
  },
  {
    name: "AWS secret access key",
    regexp: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "cloud_credentials", type: "AWS secret access key", redact: true, priority: 1 };
    },
  },
  {
    name: "GitHub token",
    regexp: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "hardcoded_secret", type: "GitHub token", redact: true, priority: 1 };
    },
  },
  {
    name: "Slack webhook URL",
    regexp: /(https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{20,})/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "webhook_secret_url", type: "Slack webhook URL", redact: true, priority: 1 };
    },
  },
  {
    name: "Slack token",
    regexp: /\b(xox[abprs]-[A-Za-z0-9-]{10,})/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "hardcoded_secret", type: "Slack token", redact: true, priority: 1 };
    },
  },
  {
    name: "Discord webhook URL",
    regexp: /(https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,})/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "webhook_secret_url", type: "Discord webhook URL", redact: true, priority: 1 };
    },
  },
  {
    name: "Stripe key",
    regexp: /\b((?:sk_live|rk_live|sk_test)_[A-Za-z0-9]{10,})/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "hardcoded_secret", type: "Stripe key", redact: true, priority: 1 };
    },
  },
  {
    name: "Google API key",
    regexp: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return span && { ...span, category: "cloud_credentials", type: "Google API key", redact: true, priority: 1 };
    },
  },
  {
    name: "JWT",
    regexp: /\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,})/g,
    build: (m) => {
      const span = spanOf(m, 1);
      if (span === null) return null;
      // The public Supabase anon key is meant for the browser: not a finding.
      if (isAnonJwt(span.value)) return null;
      if (isServiceRoleJwt(span.value)) {
        return { ...span, category: "hardcoded_secret", type: "Supabase service key", redact: true, priority: 1 };
      }
      return { ...span, category: "jwt_signing_secret", type: "JWT", redact: true, priority: 1 };
    },
  },
  {
    name: "database URL with password",
    regexp:
      /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver):\/\/[^\s:@/'"`]+:([^\s@/'"`]+)@[^\s'"`]+)/gi,
    build: (m) => {
      const url = spanOf(m, 1);
      const password = m[2];
      if (url === null || password === undefined) return null;
      if (isPlaceholderValue(password)) return null;
      return {
        start: url.start,
        end: url.end,
        value: password,
        category: "db_connection_string",
        type: "database URL with password",
        redact: true,
        priority: 1,
      };
    },
  },
  // --- provider patterns (D-28, security.md section 2) ---------------------------
  provider("Anthropic key", /\b(sk-ant-[A-Za-z0-9_-]{20,})/g, { prefix: "sk-ant-" }),
  provider("OpenRouter key", /\b(sk-or-[A-Za-z0-9_-]{32,})/g, { prefix: "sk-or-" }),
  provider("OpenAI key", /\b(sk-(?!ant-|or-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,})/g, { prefix: "sk-" }),
  provider("SendGrid key", /\b(SG\.[A-Za-z0-9_-]{16,32}\.[A-Za-z0-9_-]{30,64})/g, { prefix: "SG." }),
  provider("npm token", /\b(npm_[A-Za-z0-9]{36})\b/g, { prefix: "npm_" }),
  provider("GitLab token", /\b(glpat-[A-Za-z0-9_-]{20,})/g, { prefix: "glpat-" }),
  provider("Supabase service key", /\b(sb_secret_[A-Za-z0-9_-]{20,})/g, { prefix: "sb_secret_" }),
  provider("Twilio key", /\b(SK[0-9a-fA-F]{32})\b/g, { prefix: "SK" }),
  provider("Mailgun key", /\b(key-[0-9a-f]{32})\b/g, { prefix: "key-" }),
  provider("Mailgun key", /\b([0-9a-f]{32}-[0-9a-f]{8}-[0-9a-f]{8})\b/g),
  provider("Resend key", /\b(re_[A-Za-z0-9]{6,12}_[A-Za-z0-9]{16,40})\b/g, {
    prefix: "re_",
    extra: (value) => shannonEntropy(value.slice(3)) >= 3.5,
  }),
  provider(
    "Postmark token",
    // Bounded name runs keep the scan linear on long identifier-like text (S2-3).
    new RegExp(`postmark[A-Za-z0-9_.-]{0,64}["']?[ \\t]*(?::|=|=>|:=)[ \\t]*["'\`]?(${UUID})`, "gi"),
  ),
  provider(
    "Postmark token",
    new RegExp(`X-Postmark-(?:Server|Account)-Token["']?[ \\t]*[:,][ \\t]*["'\`]?(${UUID})`, "gi"),
  ),
  // --- generic assignment rule (D-28) ---------------------------------------------
  {
    // Quoted form, any fetched file. No upper bound on the value (D-33): it
    // runs to the closing quote and is redacted whole; the 200 KB file cap
    // bounds the work, and the value class stops at the next quote.
    name: "high-entropy assignment",
    regexp: /([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?[ \t]*(?::|=|=>|:=)[ \t]*(["'`])([^"'`\s]+)\2/g,
    build: (m) => genericMatch(m, 1, 3),
  },
  {
    // Quoted form for password-type names (D-34 / R2b-1): the value may hold
    // spaces and tabs (never a line break or quote) and runs to the closing
    // quote. The two value branches are disjoint, so there is no backtracking
    // blow-up; an unterminated quote stops at the end of the line.
    name: "high-entropy passphrase assignment",
    regexp: /([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?[ \t]*(?::|=|=>|:=)[ \t]*(["'`])((?:[^"'`\s]|[ \t])+)\2/g,
    build: (m) => genericMatch(m, 1, 3, { requireWhitespace: true }),
  },
  {
    // Unquoted form, config files only: NAME=VALUE / NAME: VALUE, optional `export ` or `- `.
    name: "unquoted assignment",
    regexp: /^[ \t]*(?:export[ \t]+|-[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]{0,63})[ \t]*[:=][ \t]*([^\s"'`]+)/gm,
    appliesTo: isUnquotedConfigFile,
    build: (m) => genericMatch(m, 1, 2),
  },
  {
    // Dockerfile ENV NAME=VALUE, ENV NAME VALUE, ARG NAME=VALUE.
    name: "Dockerfile ENV/ARG",
    regexp: /^[ \t]*(?:ENV|ARG)[ \t]+([A-Za-z_][A-Za-z0-9_]{0,63})(?:[ \t]*=[ \t]*|[ \t]+)([^\s"'`]+)/gim,
    appliesTo: isDockerfile,
    build: (m) => genericMatch(m, 1, 2),
  },
  {
    name: "public secret variable",
    regexp:
      /\b((?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_)[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)[A-Z0-9_]*)\b/g,
    build: (m) => {
      const span = spanOf(m, 1);
      return (
        span && {
          ...span,
          category: "client_exposed_secret",
          type: "public variable",
          redact: false,
          evidence: span.value.slice(0, 120),
          priority: 3,
        }
      );
    },
  },
  {
    name: "Python debug flag",
    regexp: /^[ 	]*(DEBUG[ 	]*=[ 	]*True)\b/gm,
    build: (m) => {
      const span = spanOf(m, 1);
      return (
        span && {
          ...span,
          category: "debug_config",
          type: "debug flag",
          redact: false,
          evidence: "DEBUG = True",
          priority: 3,
        }
      );
    },
  },
  {
    name: "APP_DEBUG flag",
    regexp: /^[ 	]*(?:export[ 	]+)?(APP_DEBUG[ 	]*=[ 	]*["']?(?:true|TRUE|True))\b/gm,
    build: (m) => {
      const span = spanOf(m, 1);
      return (
        span && {
          ...span,
          category: "debug_config",
          type: "debug flag",
          redact: false,
          evidence: "APP_DEBUG=true",
          priority: 3,
        }
      );
    },
  },
];

/** CI workflows, Dockerfiles and compose files: every secret match is `ci_secret`. */
export function isCiFile(path: string): boolean {
  const normalized = (normalizeRepoPath(path) ?? path).toLowerCase();
  const base = basenameOf(normalized);
  if (/^\.github\/workflows\//.test(normalized) || normalized.includes("/.github/workflows/")) return true;
  if (base === ".gitlab-ci.yml" || base === "bitbucket-pipelines.yml" || base === ".travis.yml") return true;
  if (normalized.startsWith(".circleci/") || normalized.includes("/.circleci/")) return true;
  if (base === "dockerfile" || base.startsWith("dockerfile.") || base.endsWith(".dockerfile")) return true;
  if (/^(docker-)?compose([.-][^/]*)?\.ya?ml$/.test(base)) return true;
  return false;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * Scans one file's text. Returns masked findings (deduped on category + line)
 * and the text with every secret match replaced by `[REDACTED]`.
 */
export function scan(path: string, text: string): ScanResult {
  const ci = isCiFile(path);
  const candidates: RawMatch[] = [];
  for (const detector of DETECTORS) {
    if (detector.appliesTo !== undefined && !detector.appliesTo(path)) continue;
    detector.regexp.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = detector.regexp.exec(text)) !== null) {
      if (match[0].length === 0) {
        detector.regexp.lastIndex += 1;
        continue;
      }
      const built = detector.build(match);
      // Shared placeholder rule for every value-bearing pattern (D-28).
      const placeholder =
        built !== null &&
        built.redact &&
        built.value !== "" &&
        isPlaceholderValue(
          built.value,
          built.placeholderPrefix !== undefined ? { prefix: built.placeholderPrefix } : {},
        );
      if (built !== null && !placeholder) {
        candidates.push(built);
      }
    }
  }

  // Resolve overlaps: lower priority number first, then earlier start.
  candidates.sort((a, b) => a.priority - b.priority || a.start - b.start || b.end - a.end);
  const accepted: RawMatch[] = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some((other) => candidate.start < other.end && other.start < candidate.end);
    if (!overlaps) accepted.push(candidate);
  }
  accepted.sort((a, b) => a.start - b.start);

  const starts = lineStarts(text);
  const seen = new Set<string>();
  const findings: MaskedFinding[] = [];
  for (const match of accepted) {
    const category: FindingCategory = ci && match.category !== "debug_config" ? "ci_secret" : match.category;
    const line = lineAt(starts, match.start);
    const key = `${category}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      category,
      severity: CATEGORY_SEVERITY[category],
      filePath: path,
      line,
      maskedEvidence: (match.evidence ?? maskEvidence(match.type, match.value)).slice(0, 200),
      remediation: REMEDIATION[category],
    });
  }

  let redacted = "";
  let cursor = 0;
  for (const match of accepted) {
    if (!match.redact) continue;
    redacted += text.slice(cursor, match.start) + REDACTED;
    cursor = match.end;
  }
  redacted += text.slice(cursor);

  return { findings, redacted };
}

// --- path-only findings (file never opened) --------------------------------------

const PRIVATE_KEY_BASENAME = /^(?:.*\.(?:pem|key|p12|pfx|jks|keystore|ppk|p8)|id_rsa.*|id_ed25519.*)$/i;
const CLOUD_FILE_BASENAME = /^.*\.(?:tfstate|tfstate\.backup|tfvars)$/i;
const CREDENTIAL_FILE_BASENAMES: ReadonlySet<string> = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  // D-31 / S2-7
  ".yarnrc.yml",
  "credentials.json",
  ".htpasswd",
  "wp-config.php",
]);

function pathFinding(category: FindingCategory, filePath: string): MaskedFinding {
  return {
    category,
    severity: CATEGORY_SEVERITY[category],
    filePath,
    line: null,
    maskedEvidence: PATH_ONLY_EVIDENCE,
    remediation: REMEDIATION[category],
  };
}

/**
 * Finding for a denied secret file seen in the tree (never opened), or null.
 * The broad `*secret*` / `*credentials*` globs alone never create a finding.
 */
export function pathOnlyFinding(path: string): MaskedFinding | null {
  const normalized = normalizeRepoPath(path);
  if (normalized === null) return null;
  const segments = normalized.split("/");
  const base = segments[segments.length - 1] ?? "";
  const lowerBase = base.toLowerCase();
  const dirs = segments.slice(0, -1).map((segment) => segment.toLowerCase());

  if (base !== ENV_EXAMPLE_BASENAME && (lowerBase === ".env" || lowerBase.startsWith(".env."))) {
    return pathFinding("committed_env_file", normalized);
  }
  if (PRIVATE_KEY_BASENAME.test(base)) return pathFinding("private_key", normalized);
  if (/^service-account.*\.json$/i.test(base)) return pathFinding("service_account", normalized);
  if (dirs.some((dir) => dir === ".aws" || dir === ".gcloud" || dir === ".kube")) {
    return pathFinding("cloud_credentials", normalized);
  }
  if (CLOUD_FILE_BASENAME.test(base)) return pathFinding("cloud_credentials", normalized);
  if (CREDENTIAL_FILE_BASENAMES.has(lowerBase)) return pathFinding("hardcoded_secret", normalized);
  if (lowerBase === ".pgpass") return pathFinding("db_connection_string", normalized);
  // Composer auth.json only at the root or under .composer/ (translation
  // files such as locales/en/auth.json are denied without a finding).
  if (lowerBase === "auth.json" && (dirs.length === 0 || dirs[dirs.length - 1] === ".composer")) {
    return pathFinding("hardcoded_secret", normalized);
  }
  if (lowerBase === "config.json" && dirs[dirs.length - 1] === ".docker") {
    return pathFinding("hardcoded_secret", normalized);
  }
  return null;
}

// --- dedupe and cap ------------------------------------------------------------------

export function compareFindings(a: MaskedFinding, b: MaskedFinding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0) ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

/** Dedupe on (category, filePath, line) and keep at most `max`, highest severity first. */
export function dedupeAndCapFindings(
  findings: readonly MaskedFinding[],
  max: number = MAX_FINDINGS_PER_ANALYSIS,
): MaskedFinding[] {
  const seen = new Set<string>();
  const unique: MaskedFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.category}\u0000${finding.filePath}\u0000${finding.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique.sort(compareFindings).slice(0, max);
}
