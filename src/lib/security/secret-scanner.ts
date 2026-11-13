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
}

interface Detector {
  name: string;
  regexp: RegExp;
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

const SECRET_NAME = /(key|token|secret|password|passwd)/i;
const JWT_SECRET_NAME = /(jwt|session).*(secret|key)|(secret|key).*(jwt|session)/i;
const PLACEHOLDER_VALUE = /^(?:\$|\{|<|%|your[-_]|example|changeme|xxx+|\*+$)/i;

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
      if (PLACEHOLDER_VALUE.test(password)) return null;
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
  {
    name: "high-entropy assignment",
    regexp: /([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?\s*(?::|=|=>|:=)\s*(["'`])([^"'`\s]{20,})\2/g,
    build: (m) => {
      const name = m[1];
      const value = m[3];
      if (name === undefined || value === undefined) return null;
      if (!SECRET_NAME.test(name)) return null;
      if (PLACEHOLDER_VALUE.test(value)) return null;
      if (shannonEntropy(value) < 3.5) return null;
      const quoteOffset = m[0].lastIndexOf(value);
      const start = m.index + quoteOffset;
      const category: FindingCategory = JWT_SECRET_NAME.test(name) ? "jwt_signing_secret" : "hardcoded_secret";
      return {
        start,
        end: start + value.length,
        value,
        category,
        type: "high-entropy secret",
        redact: true,
        priority: 2,
      };
    },
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
    regexp: /^[ 	]*(DEBUG[ 	]*=[ 	]*True)/gm,
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
    regexp: /^[ 	]*(?:export[ 	]+)?(APP_DEBUG[ 	]*=[ 	]*["']?(?:true|TRUE|True))/gm,
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
    detector.regexp.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = detector.regexp.exec(text)) !== null) {
      if (match[0].length === 0) {
        detector.regexp.lastIndex += 1;
        continue;
      }
      const built = detector.build(match);
      if (built !== null) candidates.push(built);
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

const PRIVATE_KEY_BASENAME = /^(?:.*\.(?:pem|key|p12|pfx|jks|keystore|ppk)|id_rsa.*|id_ed25519.*)$/i;
const CLOUD_FILE_BASENAME = /^.*\.(?:tfstate|tfstate\.backup|tfvars)$/i;
const CREDENTIAL_FILE_BASENAMES: ReadonlySet<string> = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
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
