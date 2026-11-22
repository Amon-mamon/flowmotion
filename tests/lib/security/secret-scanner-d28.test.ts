// @vitest-environment node
/**
 * D-28 / S2-2: widened scanner (security.md section 2). For every provider
 * pattern and both generic forms: one positive case and one placeholder case
 * that must not match. Values are assembled at runtime.
 */
import { describe, expect, it } from "vitest";

import { REDACTED, isPlaceholderValue, scan } from "@/lib/security/secret-scanner";

const R = (n: number, alphabet = "aZ3kQ9xLmP2vW7tR5yB8nC4dF6gH1jK0") =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const HEX = (n: number) => Array.from({ length: n }, (_, i) => "0123456789abcdef"[(i * 5 + 3) % 16]).join("");

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const P = {
  anthropic: "sk-ant-" + "api03-" + R(40),
  openrouter: "sk-or-" + "v1-" + R(48),
  openai: "sk-" + "proj-" + R(48),
  openaiLegacy: "sk-" + R(48),
  sendgrid: "SG." + R(22) + "." + R(43),
  npm: "npm_" + R(36),
  gitlab: "glpat-" + R(20),
  sbSecret: "sb_secret_" + R(30),
  twilio: "SK" + HEX(32),
  mailgun: "key-" + HEX(32),
  mailgun2: HEX(32) + "-" + HEX(8) + "-" + HEX(8),
  resend: "re_" + R(8) + "_" + R(24),
  postmarkUuid: "3f2a9c41-7b1e-4d8a-9c2f-6e5b4a3d2c1b",
  serviceJwt: `${b64url({ alg: "HS256" })}.${b64url({ role: "service_role", iss: "supabase" })}.${R(40)}`,
};

function expectFinding(path: string, text: string, raw: string, type?: string) {
  const result = scan(path, text);
  expect(result.findings.length, text).toBeGreaterThan(0);
  if (type !== undefined) expect(result.findings[0]?.maskedEvidence.startsWith(type), text).toBe(true);
  expect(result.redacted).not.toContain(raw);
  expect(result.redacted).toContain(REDACTED);
  expect(JSON.stringify(result.findings)).not.toContain(raw);
}

function expectNone(path: string, text: string) {
  const result = scan(path, text);
  expect(result.findings, text).toEqual([]);
  expect(result.redacted).toBe(text);
}

describe("provider patterns: positive (any file, quoted or not)", () => {
  it.each([
    ["Anthropic key", `client(${P.anthropic})`, P.anthropic],
    ["OpenRouter key", `const k = ${P.openrouter};`, P.openrouter],
    ["OpenAI key", `openai(${P.openai})`, P.openai],
    ["OpenAI key", `openai(${P.openaiLegacy})`, P.openaiLegacy],
    ["SendGrid key", `sg(${P.sendgrid})`, P.sendgrid],
    ["npm token", `//registry.npmjs.org/:_authToken=${P.npm}`, P.npm],
    ["GitLab token", `t(${P.gitlab})`, P.gitlab],
    ["Supabase service key", `createClient(url, ${P.sbSecret})`, P.sbSecret],
    ["Supabase service key", `createClient(url, "${P.serviceJwt}")`, P.serviceJwt],
    ["Twilio key", `twilio(${P.twilio})`, P.twilio],
    ["Mailgun key", `mg(${P.mailgun})`, P.mailgun],
    ["Mailgun key", `mg(${P.mailgun2})`, P.mailgun2],
    ["Resend key", `new Resend(${P.resend})`, P.resend],
    ["Postmark token", `POSTMARK_SERVER = ${P.postmarkUuid}`, P.postmarkUuid],
    ["Postmark token", `headers: { "X-Postmark-Server-Token": "${P.postmarkUuid}" }`, P.postmarkUuid],
  ])("%s", (type, text, raw) => {
    expectFinding("src/client.ts", text, raw, type);
    expect(scan("src/client.ts", text).findings[0]?.category).toBe("hardcoded_secret");
  });

  it("sk-ant- and sk-or- are Anthropic / OpenRouter, never OpenAI", () => {
    expect(scan("a.ts", P.anthropic).findings.map((f) => f.maskedEvidence.split(":")[0])).toEqual(["Anthropic key"]);
    expect(scan("a.ts", P.openrouter).findings.map((f) => f.maskedEvidence.split(":")[0])).toEqual(["OpenRouter key"]);
  });
});

describe("provider patterns: placeholders never match", () => {
  it.each([
    ["Anthropic", "sk-ant-" + "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
    ["OpenRouter", "sk-or-" + "v1-example-" + R(30)],
    ["OpenAI", "sk-" + "proj-" + "your_key_" + "changeme_" + R(30)],
    ["SendGrid", "SG." + "x".repeat(22) + "." + "x".repeat(43)],
    ["npm", "npm_" + "x".repeat(36)],
    // D-33: placeholder words count only as whole words.
    ["GitLab", "glpat-" + "EXAMPLE-" + R(20)],
    ["Supabase sb_secret", "sb_secret_" + "xxx-" + R(20)],
    ["Twilio", "SK" + "0".repeat(32)],
    ["Mailgun", "key-" + "0".repeat(32)],
    ["Resend low entropy", "re_" + "aaaaaaaa_" + "a".repeat(20)],
    ["Postmark", "POSTMARK_SERVER_TOKEN=${POSTMARK_TOKEN}"],
  ])("%s", (_name, text) => expectNone("src/x.ts", text));

  it("sb_publishable_ keys and anon JWTs are public", () => {
    expectNone("src/x.ts", `createClient(url, "sb_publishable_${R(30)}")`);
    const anon = `${b64url({ alg: "HS256" })}.${b64url({ role: "anon" })}.${R(40)}`;
    expectNone("src/x.ts", `const anon = "${anon}"`);
  });

  it("Python re_ identifiers are not Resend keys", () => {
    expectNone("a.py", "re_compiled_pattern_for_emails = 1");
  });
});

describe("generic rule: quoted form (any file, widened names)", () => {
  const value = R(28);
  it.each(["apiKey", "AUTH_TOKEN", "db_password", "DB_PWD", "gcpCredential", "authHeader", "client_secret"])(
    "%s = '<high entropy>' → finding",
    (name) => expectFinding("src/config.ts", `const ${name} = "${value}";`, value),
  );
  it.each([
    'const apiKey = "";',
    'const apiKey = "your-api-key-goes-right-here-ok";',
    'const apiKey = "your_api_key_goes_right_here_ok";',
    'const token = "changeme-changeme-changeme-123";',
    'const token = "this-is-an-example-token-value1";',
    'const token = "<insert-your-token-here-please>";',
    'const token = "${SECRET_FROM_ENVIRONMENT_VAR}";',
    'const token = "{{ secrets.DEPLOY_TOKEN_VALUE }}";',
    'const token = "$DEPLOY_TOKEN_VALUE_FROM_ENV";',
    // D-33: a bare name must be under 20 chars or low entropy to count as a placeholder.
    'const token = "DEPLOY_TOKEN_REF";',
    'const token = "zzzzzzzzzzzzzzzzzzzzzzzzzzz";',
  ])("placeholder: %s", (text) => expectNone("src/config.ts", text));
});

describe("generic rule: unquoted form (config files only)", () => {
  const value = R(28);
  it("`.env.example` NAME=VALUE and export", () => {
    expectFinding(".env.example", `API_KEY=${value}\n`, value);
    expectFinding(".env.example", `export STRIPE_SECRET=${value}\n`, value);
  });
  it("compose environment: list", () => {
    const text = `services:\n  api:\n    environment:\n      - DB_PASSWORD=${value}\n`;
    const result = scan("docker-compose.yml", text);
    expect(result.findings[0]).toMatchObject({ category: "ci_secret", line: 4 });
    expect(result.redacted).not.toContain(value);
  });
  it("YAML password: value", () => {
    expectFinding("config/app.yml", `database:\n  password: ${value}\n`, value);
    expectFinding("config/app.toml", `auth_token = ${value}\n`, value);
  });
  it("Dockerfile ENV / ARG", () => {
    expectFinding("Dockerfile", `FROM node:22\nENV API_TOKEN=${value}\n`, value);
    expectFinding("Dockerfile", `ENV API_TOKEN ${value}\n`, value);
    expectFinding("Dockerfile", `ARG NPM_AUTH=${value}\n`, value);
  });
  it("workflow env: block", () => {
    const text = `jobs:\n  build:\n    env:\n      DEPLOY_KEY: ${value}\n`;
    const result = scan(".github/workflows/ci.yml", text);
    expect(result.findings[0]?.category).toBe("ci_secret");
    expect(result.redacted).not.toContain(value);
  });
  it("Procfile", () => expectFinding("Procfile", `web: SECRET_KEY=${value} node app.js\n`.replace("web: ", ""), value));
  it("a provider key unquoted in config matches even when short-entropy rule would not", () => {
    expectFinding(".env.example", `OPENAI_KEY=${P.openai}\n`, P.openai, "OpenAI key");
  });

  it.each([
    [".env.example", "API_KEY=\n"],
    [".env.example", "API_KEY=your-api-key\n"],
    [".env.example", "API_KEY=changeme\n"],
    [".env.example", "API_KEY=<your key>\n"],
    [".env.example", "JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx\n"],
    ["docker-compose.yml", "    environment:\n      - DB_PASSWORD=${DB_PASSWORD}\n"],
    [".github/workflows/ci.yml", "    env:\n      DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}\n"],
    ["config/app.yml", "password: $DB_PASSWORD_FROM_ENV\n"],
    ["config/app.yml", "token_name: DEPLOY_TOKEN_NAME\n"],
    ["Dockerfile", "ARG NPM_TOKEN\nENV NPM_TOKEN=$NPM_TOKEN\n"],
  ])("placeholder in %s: %j", (path, text) => expectNone(path, text));

  it("never applies to source code (unquoted values are expressions)", () => {
    expectNone("src/client.ts", "const config = { apiKey: process.env.OPENAI_API_KEY };");
    expectNone("src/client.ts", `apiKey: someVeryLongIdentifierNameHere${R(10)}`);
  });

  it("raw values are absent from findings and redacted text", () => {
    const text = `API_KEY=${value}\nOTHER=${P.anthropic}\n`;
    const result = scan(".env.example", text);
    expect(result.findings).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(value);
    expect(JSON.stringify(result)).not.toContain(P.anthropic);
  });
});

describe("isPlaceholderValue", () => {
  it("shared rule", () => {
    for (const v of ["", "your-x", "your_x", "x-changeme-x", "an.EXAMPLE", "a-XXX-b", "<x>", "${X}", "{{X}}", "$X", "aaaa"]) {
      expect(isPlaceholderValue(v), v).toBe(true);
    }
    // D-33: embedded in a longer alphanumeric run, the words are not placeholders.
    for (const v of ["xchangemex", "anEXAMPLE", "aXXXb", "zxxxq"]) {
      expect(isPlaceholderValue(v), v).toBe(false);
    }
    expect(isPlaceholderValue("MY_VAR")).toBe(false);
    expect(isPlaceholderValue("MY_VAR", { bareName: true })).toBe(true);
    expect(isPlaceholderValue(R(20))).toBe(false);
  });
});
