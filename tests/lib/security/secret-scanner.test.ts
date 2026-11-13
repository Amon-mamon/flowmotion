// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_FINDINGS_PER_ANALYSIS,
  PATH_ONLY_EVIDENCE,
  REDACTED,
  REMEDIATION,
  dedupeAndCapFindings,
  maskEvidence,
  pathOnlyFinding,
  scan,
  type MaskedFinding,
} from "@/lib/security/secret-scanner";

// Values assembled at runtime so this file itself does not look like it holds secrets.
const AWS_ID = "AKIA" + "Q3EGRZ7XN5MBW2PL";
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY" + "Q9zW3kLpVm";
const GH_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const GH_PAT = "github_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";
const SLACK_TOKEN = "xoxb-" + "123456789012-abcdefghijkl";
const SLACK_HOOK = "https://hooks.slack.com/services/" + "T04KF8H2Q/B07LMN3PQ/aZ9kL2mN4pQ6rS8tU0vW1yX3";
const DISCORD_HOOK = "https://discord.com/api/webhooks/" + "123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF";
const STRIPE_LIVE = "sk_live_" + "51HabcdefGHIJKLmnop";
const STRIPE_RK = "rk_live_" + "51HabcdefGHIJKLmnop";
const STRIPE_TEST = "sk_test_" + "51HabcdefGHIJKLmnop";
const GOOGLE = "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
const PG_PASSWORD = "s3cr3tP4ssw0rdX";
const PG_URL = `postgres://app:${PG_PASSWORD}@db.example.com:5432/app`;
const HIGH_ENTROPY = "Zx8Qp2Lm9Vt4Rk7Wn3Yb6Hc1";

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const JWT_SERVICE = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role: "service_role", iss: "supabase" })}.abcdefghijklmnopqrstuvwxyz012345`;
const JWT_USER = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role: "authenticated", sub: "u1" })}.abcdefghijklmnopqrstuvwxyz012345`;
const JWT_ANON = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role: "anon", iss: "supabase" })}.abcdefghijklmnopqrstuvwxyz012345`;
const PEM = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAx1y2z3", "-----END RSA PRIVATE KEY-----"].join("\n");

function only(path: string, text: string): MaskedFinding {
  const result = scan(path, text);
  expect(result.findings, text).toHaveLength(1);
  return result.findings[0] as MaskedFinding;
}

function assertNoRaw(path: string, text: string, raw: string) {
  const result = scan(path, text);
  expect(result.redacted).not.toContain(raw);
  expect(result.redacted).toContain(REDACTED);
  expect(JSON.stringify(result.findings)).not.toContain(raw);
}

describe("secret scanner: patterns (positive)", () => {
  it.each([
    ["AWS access key id", `const id = "${AWS_ID}";`, AWS_ID, "cloud_credentials"],
    ["AWS secret access key", `aws_secret_access_key = ${AWS_SECRET}`, AWS_SECRET, "cloud_credentials"],
    ["GitHub ghp_ token", `token: ${GH_TOKEN}`, GH_TOKEN, "hardcoded_secret"],
    ["GitHub fine-grained PAT", `t=${GH_PAT}`, GH_PAT, "hardcoded_secret"],
    ["Slack token", `const slack = '${SLACK_TOKEN}'`, SLACK_TOKEN, "hardcoded_secret"],
    ["Slack webhook URL", `url: ${SLACK_HOOK}`, SLACK_HOOK, "webhook_secret_url"],
    ["Discord webhook URL", `url: ${DISCORD_HOOK}`, DISCORD_HOOK, "webhook_secret_url"],
    ["Stripe live key", `stripe(${STRIPE_LIVE})`, STRIPE_LIVE, "hardcoded_secret"],
    ["Stripe restricted key", `stripe(${STRIPE_RK})`, STRIPE_RK, "hardcoded_secret"],
    ["Stripe test key", `stripe(${STRIPE_TEST})`, STRIPE_TEST, "hardcoded_secret"],
    ["Google API key", `key=${GOOGLE}`, GOOGLE, "cloud_credentials"],
    ["JWT (Supabase service role)", `const k = "${JWT_SERVICE}"`, JWT_SERVICE, "hardcoded_secret"],
    ["JWT (other)", `const k = "${JWT_USER}"`, JWT_USER, "jwt_signing_secret"],
    ["DB URL with password", `DATABASE_URL=${PG_URL}`, PG_PASSWORD, "db_connection_string"],
    ["high-entropy assignment", `const apiKey = "${HIGH_ENTROPY}";`, HIGH_ENTROPY, "hardcoded_secret"],
    ["high-entropy JWT secret", `JWT_SECRET: "${HIGH_ENTROPY}"`, HIGH_ENTROPY, "jwt_signing_secret"],
  ])("%s", (_name, text, raw, category) => {
    const finding = only("src/config.ts", text);
    expect(finding.category).toBe(category);
    expect(finding.line).toBe(1);
    expect(finding.remediation).toBe(REMEDIATION[finding.category]);
    assertNoRaw("src/config.ts", text, raw);
  });

  it.each(["ghp_", "gho_", "ghu_", "ghs_", "ghr_"])("GitHub prefix %s", (prefix) => {
    const token = prefix + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    expect(only("a.ts", `x=${token}`).category).toBe("hardcoded_secret");
  });

  it.each(["xoxa-", "xoxb-", "xoxp-", "xoxr-", "xoxs-"])("Slack prefix %s", (prefix) => {
    expect(only("a.ts", `x=${prefix}123456789012-abc`).category).toBe("hardcoded_secret");
  });

  it("PEM / OpenSSH / PGP private key blocks", () => {
    for (const label of ["RSA PRIVATE KEY", "OPENSSH PRIVATE KEY", "PGP PRIVATE KEY BLOCK", "PRIVATE KEY", "EC PRIVATE KEY"]) {
      const block = `-----BEGIN ${label}-----\nAAAAB3NzaC1yc2EAAAADAQAB\n-----END ${label}-----`;
      const result = scan("keys.ts", `const k = \`${block}\`;`);
      expect(result.findings.map((f) => f.category)).toEqual(["private_key"]);
      expect(result.findings[0]?.maskedEvidence).toBe("private key block");
      expect(result.redacted).not.toContain("AAAAB3NzaC1yc2EAAAADAQAB");
    }
  });

  it("client_exposed_secret: public variable names (evidence is the name, value not redacted)", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "VITE_STRIPE_SECRET", "EXPO_PUBLIC_DB_PASSWORD", "REACT_APP_PRIVATE_TOKEN"]) {
      const finding = only("src/client.ts", `const x = process.env.${name};`);
      expect(finding.category).toBe("client_exposed_secret");
      expect(finding.maskedEvidence).toBe(name);
    }
  });

  it("debug_config: DEBUG = True and APP_DEBUG=true", () => {
    expect(only("settings.py", "DEBUG = True\n")).toMatchObject({ category: "debug_config", severity: "low", maskedEvidence: "DEBUG = True" });
    expect(only("config.php", "APP_DEBUG=true\n")).toMatchObject({ category: "debug_config", maskedEvidence: "APP_DEBUG=true" });
  });
});

describe("secret scanner: negatives", () => {
  it.each([
    ["plain code", "export function add(a, b) { return a + b; }"],
    ["short key value", 'const apiKey = "abc";'],
    ["low entropy", 'const password = "aaaaaaaaaaaaaaaaaaaaaaaa";'],
    ["placeholder", 'const token = "your-token-goes-here-please-change";'],
    ["env reference", "const secret = process.env.SECRET_KEY;"],
    ["DB URL without password", "postgres://localhost:5432/app"],
    ["DB URL with placeholder password", "postgres://user:${PASSWORD}@host/db"],
    ["entropy but no secret-like name", `const greeting = "${HIGH_ENTROPY}";`],
    ["public non-secret var", "process.env.NEXT_PUBLIC_SUPABASE_URL"],
    ["DEBUG = False", "DEBUG = False"],
    ["short AKIA", "AKIA123"],
  ])("%s → no finding", (_name, text) => {
    const result = scan("src/x.ts", text);
    expect(result.findings).toEqual([]);
    expect(result.redacted).toBe(text);
  });

  it("skips the public Supabase anon JWT", () => {
    const result = scan("src/supabase.ts", `const anon = "${JWT_ANON}";`);
    expect(result.findings).toEqual([]);
    expect(result.redacted).toContain(JWT_ANON);
  });
});

describe("secret scanner: masking, lines, categories", () => {
  it("masks as '<type>: <first 2>…<last 2>' or the type alone under 12 chars", () => {
    expect(maskEvidence("Stripe key", STRIPE_LIVE)).toBe(`Stripe key: sk…${STRIPE_LIVE.slice(-2)}`);
    expect(maskEvidence("x", "abcdefghijk")).toBe("x");
    expect(maskEvidence("x", "abcdefghijkl")).toBe("x: ab…kl");
  });

  it("evidence never holds more than 4 characters of the value", () => {
    const finding = only("a.ts", `x=${GH_TOKEN}`);
    expect(finding.maskedEvidence).toBe(`GitHub token: gh…${GH_TOKEN.slice(-2)}`);
    // the DB URL evidence is masked on the password only
    const db = only("a.ts", `url=${PG_URL}`);
    expect(db.maskedEvidence).toBe(`database URL with password: ${PG_PASSWORD.slice(0, 2)}…${PG_PASSWORD.slice(-2)}`);
    expect(db.maskedEvidence).not.toContain("db.example.com");
  });

  it("reports 1-based line numbers", () => {
    const text = ["line one", "line two", `const t = "${GH_TOKEN}";`, "", `key=${GOOGLE}`].join("\n");
    const result = scan("a.ts", text);
    expect(result.findings.map((f) => f.line)).toEqual([3, 5]);
  });

  it("any match in CI files, Dockerfiles and compose files is ci_secret", () => {
    for (const path of [".github/workflows/deploy.yml", "Dockerfile", "docker-compose.yml", "compose.yaml", "api/Dockerfile.prod"]) {
      const finding = only(path, `ENV TOKEN=${GH_TOKEN}`);
      expect(finding.category, path).toBe("ci_secret");
      expect(finding.severity).toBe("high");
    }
  });

  it("redacts every match and keeps the rest of the text", () => {
    const text = `a=${GH_TOKEN}\nb=${STRIPE_LIVE}\nc=hello`;
    const result = scan("x.ts", text);
    expect(result.redacted).toBe(`a=${REDACTED}\nb=${REDACTED}\nc=hello`);
  });

  it("dedupes on category + line inside one file", () => {
    const result = scan("x.ts", `a=${GH_TOKEN} b=${GH_TOKEN.replace("a1", "z9")}`);
    expect(result.findings).toHaveLength(1);
    expect(result.redacted.match(/\[REDACTED\]/g)).toHaveLength(2);
  });
});

describe("secret scanner: purity (raw values never logged)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not call console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    scan("a.ts", `x=${GH_TOKEN}\n${PEM}\nurl=${PG_URL}`);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("path-only findings (file never opened)", () => {
  it.each([
    [".env", "committed_env_file"],
    ["apps/web/.env.production", "committed_env_file"],
    ["certs/server.pem", "private_key"],
    ["a.key", "private_key"],
    ["a.p12", "private_key"],
    ["a.pfx", "private_key"],
    ["a.jks", "private_key"],
    ["a.keystore", "private_key"],
    ["a.ppk", "private_key"],
    ["id_rsa", "private_key"],
    ["id_ed25519.pub", "private_key"],
    ["service-account-prod.json", "service_account"],
    [".aws/credentials", "cloud_credentials"],
    [".gcloud/x.json", "cloud_credentials"],
    [".kube/config", "cloud_credentials"],
    ["infra/main.tfstate", "cloud_credentials"],
    ["infra/main.tfstate.backup", "cloud_credentials"],
    ["prod.tfvars", "cloud_credentials"],
    [".npmrc", "hardcoded_secret"],
    [".pypirc", "hardcoded_secret"],
    [".netrc", "hardcoded_secret"],
    [".git-credentials", "hardcoded_secret"],
    [".docker/config.json", "hardcoded_secret"],
  ])("%s → %s", (path, category) => {
    const finding = pathOnlyFinding(path);
    expect(finding).toMatchObject({ category, line: null, maskedEvidence: PATH_ONLY_EVIDENCE });
  });

  it.each([".env.example", "src/secrets-client.ts", "credentialsForm.tsx", "node_modules/x.js", "src/app.ts"])(
    "%s → no path finding",
    (path) => expect(pathOnlyFinding(path)).toBeNull(),
  );
});

describe("dedupeAndCapFindings", () => {
  const finding = (i: number, severity: "low" | "medium" | "high"): MaskedFinding => ({
    category: severity === "low" ? "debug_config" : severity === "medium" ? "webhook_secret_url" : "hardcoded_secret",
    severity,
    filePath: `f${String(i).padStart(4, "0")}.ts`,
    line: 1,
    maskedEvidence: "x",
    remediation: "y",
  });

  it("dedupes on (category, filePath, line) and keeps the highest severity first", () => {
    const list = [finding(1, "low"), finding(2, "high"), finding(2, "high"), finding(3, "medium")];
    const out = dedupeAndCapFindings(list);
    expect(out.map((f) => f.severity)).toEqual(["high", "medium", "low"]);
  });

  it("caps at 200 per analysis, dropping the lowest severities", () => {
    const list = [
      ...Array.from({ length: 150 }, (_, i) => finding(i, "low")),
      ...Array.from({ length: 100 }, (_, i) => finding(1000 + i, "high")),
    ];
    const out = dedupeAndCapFindings(list);
    expect(out).toHaveLength(MAX_FINDINGS_PER_ANALYSIS);
    expect(out.filter((f) => f.severity === "high")).toHaveLength(100);
  });
});
