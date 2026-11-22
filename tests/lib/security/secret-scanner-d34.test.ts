// @vitest-environment node
/**
 * D-34 Phase 2b review fixes (contract section 11 "Phase 2b review fixes",
 * backend items 1, 3, 5; security.md section 2): quoted passphrases for
 * password-type names (R2b-1), long bare names reported (R2b-4), and the
 * versioned provider prefix placeholder (R2b-6).
 */
import { describe, expect, it } from "vitest";

import {
  PASSWORD_TYPE_NAME,
  REDACTED,
  SECRET_NAME,
  isPlaceholderValue,
  scan,
} from "@/lib/security/secret-scanner";

function assertNoRawRun(raw: string, haystack: string, label: string) {
  for (let i = 0; i + 5 <= raw.length; i += 1) {
    const run = raw.slice(i, i + 5);
    if (haystack.includes(run)) throw new Error(`${label}: a 5-character run of the raw value survived (offset ${i})`);
  }
}

function expectSecret(path: string, text: string, raw: string) {
  const result = scan(path, text);
  expect(result.findings, text.slice(0, 80)).toHaveLength(1);
  const finding = result.findings[0];
  expect(finding?.category).toBe("hardcoded_secret");
  expect(finding?.maskedEvidence).toBe(`high-entropy secret: ${raw.slice(0, 2)}…${raw.slice(-2)}`);
  expect(result.redacted).toBe(text.replace(raw, REDACTED));
  assertNoRawRun(raw, result.redacted, "redacted");
  assertNoRawRun(raw, JSON.stringify(result.findings), "findings");
}

function expectNone(path: string, text: string) {
  const result = scan(path, text);
  expect(result.findings, text).toEqual([]);
  expect(result.redacted).toBe(text);
}

describe("R2b-1: quoted passphrases for password-type names", () => {
  it("name lists include passphrase and the _pass suffix", () => {
    for (const name of ["passphrase", "DB_PASS", "smtp_pass", "WALLET_PASSPHRASE"]) {
      expect(SECRET_NAME.test(name), name).toBe(true);
      expect(PASSWORD_TYPE_NAME.test(name), name).toBe(true);
    }
    for (const name of ["authError", "apiKey", "token", "compass", "bypass", "pass_through"]) {
      expect(PASSWORD_TYPE_NAME.test(name), name).toBe(false);
    }
    expect(SECRET_NAME.test("bypass")).toBe(false);
  });

  it("TypeScript password with spaces → one finding, whole value redacted", () => {
    const raw = "correct horse battery staple 99";
    expectSecret("src/db.ts", `const password = "${raw}";\n`, raw);
  });

  it("YAML DB_PASS with spaces and symbols → one finding", () => {
    const raw = "Tr0ub4dor & 3 extra words!";
    expectSecret("config/app.yml", `DB_PASS: "${raw}"\n`, raw);
  });

  it("tabs are allowed inside the quotes; single quotes and backticks work too", () => {
    const raw = "correct\thorse battery staple 99";
    expectSecret("src/db.ts", `const passphrase = '${raw}';\n`, raw);
    expectSecret("src/db.ts", "const dbPassword = `" + raw + "`;\n", raw);
  });

  it("negative: non-secret names and non-password names keep the no-whitespace rule", () => {
    expectNone("src/ui.ts", `title = "hello world example text here"\n`);
    expectNone("src/ui.ts", `authError: "Authentication failed, please retry"\n`);
    expectNone("src/ui.ts", `const apiKey = "Some key text with spaces 123 ABC";\n`);
  });

  it("negative: a passphrase value never crosses a line break or a quote", () => {
    expectNone("src/db.ts", `const password = "correct horse\nbattery staple 99";\n`);
    expectNone("src/db.ts", `const password = "correct horse 'battery' staple 99";\n`);
  });

  it("negative: placeholders and low-entropy phrases are skipped", () => {
    expectNone("src/db.ts", `const password = "your password goes here";\n`);
    expectNone("src/db.ts", `const password = "changeme please now ok";\n`);
    expectNone("src/db.ts", `const password = "a a a a a a a a a a a a";\n`);
    expectNone("src/db.ts", `const password = "short one";\n`);
  });

  it("linear time: 200 KB unterminated passphrase quote scans in under 1 s", () => {
    const words = "lorem ipsum dolor sit amet consectetur adipiscing elit ";
    const oneLine = `password = "${words.repeat(Math.ceil(200_000 / words.length))}`;
    const manyLines = `password = "${words}\n`.repeat(Math.ceil(200_000 / (words.length + 13)));
    const repeated = `a_pass = "x y `.repeat(Math.ceil(200_000 / 14));
    for (const text of [oneLine, manyLines, repeated]) {
      const started = performance.now();
      scan("src/big.ts", text.slice(0, 200_000));
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});

describe("R2b-4: long bare names are reported (accepted fail-safe, D-34 (c))", () => {
  it('const tokenEnv = "STRIPE_SECRET_KEY_PRODUCTION" → one hardcoded_secret finding, whole value redacted', () => {
    const raw = "STRIPE_SECRET_KEY_PRODUCTION";
    expectSecret("src/config.ts", `const tokenEnv = "${raw}";\n`, raw);
  });
});

describe("R2b-6: versioned provider prefix placeholder", () => {
  const zeros = "sk-or-v1-" + "0".repeat(64);

  it("isPlaceholderValue skips a v<digits>- segment after the prefix", () => {
    expect(isPlaceholderValue(zeros, { prefix: "sk-or-" })).toBe(true);
    expect(isPlaceholderValue("sk-or-v12-" + "a".repeat(40), { prefix: "sk-or-" })).toBe(true);
    expect(isPlaceholderValue("sk-or-v1-" + "0".repeat(63) + "1", { prefix: "sk-or-" })).toBe(false);
  });

  it("OPENROUTER_API_KEY=sk-or-v1- + 64 zeros → no finding", () => {
    expectNone(".env.example", `OPENROUTER_API_KEY=${zeros}\n`);
    expectNone("src/config.ts", `const openrouterKey = "${zeros}";\n`);
  });
});
