// @vitest-environment node
/**
 * D-33 / S2R-1 scanner regressions (contract section 11, Phase 2b backend
 * item 5; security.md section 2). Every positive case asserts the finding,
 * the masked evidence rule, and that no run of more than 4 characters of the
 * raw value survives in the findings or the redacted text.
 */
import { describe, expect, it } from "vitest";

import { REDACTED, scan } from "@/lib/security/secret-scanner";

/** Deterministic pseudo-random string over an alphabet (no real secret). */
function rand(n: number, seed: number, alphabet: string): string {
  let x = seed >>> 0;
  let out = "";
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out += alphabet[(x >>> 16) % alphabet.length];
  }
  return out;
}

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BASE64 = ALNUM + "+/";

function assertNoRawRun(raw: string, haystack: string, label: string) {
  for (let i = 0; i + 5 <= raw.length; i += 1) {
    const run = raw.slice(i, i + 5);
    if (haystack.includes(run)) throw new Error(`${label}: a 5-character run of the raw value survived (offset ${i})`);
  }
}

function expectSecret(path: string, text: string, raw: string, type: string) {
  const result = scan(path, text);
  expect(result.findings, text.slice(0, 80)).toHaveLength(1);
  const finding = result.findings[0];
  expect(finding).toBeDefined();
  if (finding === undefined) return;
  // Masked evidence rule: the type plus at most the first 2 and last 2 characters.
  const expected = raw.length < 12 ? type : `${type}: ${raw.slice(0, 2)}…${raw.slice(-2)}`;
  expect(finding.maskedEvidence).toBe(expected);
  expect(result.redacted).toContain(REDACTED);
  expect(result.redacted).not.toContain(raw);
  assertNoRawRun(raw, result.redacted, "redacted");
  assertNoRawRun(raw, JSON.stringify(result.findings), "findings");
  // The whole value is replaced, never only a prefix.
  expect(result.redacted).toBe(text.replace(raw, REDACTED));
}

function expectNone(path: string, text: string) {
  const result = scan(path, text);
  expect(result.findings, text).toEqual([]);
  expect(result.redacted).toBe(text);
}

const GENERIC = "high-entropy secret";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const UPPER = "ABCD1234EFGH5678IJKL9012MNOP";
const LICENSE = "A7F3K9Q2M8X4P1Z6R5T0B3N7";

describe("S2R-1 positive cases", () => {
  it("base32 TOTP seed in .env.example (no entropy needed)", () => {
    expectSecret(".env.example", `TOTP_SECRET=${TOTP}\n`, TOTP, GENERIC);
  });

  it("base32 TOTP seed in YAML", () => {
    expectSecret("config/app.yml", `totp_secret: ${TOTP}\n`, TOTP, GENERIC);
  });

  it("uppercase alphanumeric license key in .env.example", () => {
    expectSecret(".env.example", `LICENSE_KEY=${LICENSE}\n`, LICENSE, GENERIC);
  });

  it("uppercase alphanumeric value in YAML auth:", () => {
    expectSecret("config/app.yml", `auth: ${UPPER}\n`, UPPER, GENERIC);
  });

  it("uppercase alphanumeric value quoted in TypeScript", () => {
    expectSecret("src/config.ts", `const apiKey = '${UPPER}'\n`, UPPER, GENERIC);
  });

  it("quoted 600-character base64 value in a .ts file: one finding, fully redacted", () => {
    const value = rand(600, 11, BASE64);
    expectSecret("src/keys.ts", `export const privateToken = "${value}";\n`, value, GENERIC);
  });

  it("unquoted 700-character value in .env.example: fully redacted", () => {
    const value = rand(700, 23, ALNUM);
    const text = `SIGNING_SECRET=${value}\n`;
    expectSecret(".env.example", text, value, GENERIC);
    const redacted = scan(".env.example", text).redacted;
    expect(redacted).toBe(`SIGNING_SECRET=${REDACTED}\n`);
    assertNoRawRun(value.slice(-188), redacted, "last 188");
  });

  it("OpenRouter token containing aXxXb is reported as OpenRouter", () => {
    const body = rand(30, 5, ALNUM) + "aXxXb" + rand(29, 7, ALNUM);
    expect(body).toHaveLength(64);
    const token = "sk-or-v1-" + body;
    expectSecret(".env.example", `OPENROUTER_API_KEY=${token}\n`, token, "OpenRouter key");
    expectSecret("src/client.ts", `client(${token})\n`, token, "OpenRouter key");
  });

  it("generic 32-character random value containing zxxxq", () => {
    const value = rand(14, 3, ALNUM) + "zxxxq" + rand(13, 9, ALNUM);
    expect(value).toHaveLength(32);
    expectSecret(".env.example", `SESSION_TOKEN=${value}\n`, value, GENERIC);
  });
});

describe("S2R-1 negative cases (no finding, text unchanged)", () => {
  it.each([
    [".env.example", "API_KEY=OTHER_VAR\n"],
    ["config/app.yml", "SECRET_KEY: SECRET_KEY_BASE\n"],
    [".env.example", "AUTH_MODE=DISABLED\n"],
    [".github/workflows/ci.yml", "    env:\n      TOKEN=${{ secrets.X }}\n"],
    [".env.example", "TOKEN=${{ secrets.X }}\n"],
    [".env.example", "SECRET=your-key-here\n"],
    [".env.example", "API_KEY=example-key-123\n"],
    ["config/app.yml", "password: changeme\n"],
    [".env.example", `OPENROUTER_API_KEY=sk-or-v1-${"x".repeat(40)}\n`],
    ["src/client.ts", `const k = "sk-ant-${"x".repeat(40)}";\n`],
    [".env.example", `ANTHROPIC_API_KEY=sk-ant-${"x".repeat(40)}\n`],
    ["src/client.ts", "const config = { apiKey: process.env.OPENAI_API_KEY };\n"],
  ])("%s: %j", (path, text) => expectNone(path, text));
});
