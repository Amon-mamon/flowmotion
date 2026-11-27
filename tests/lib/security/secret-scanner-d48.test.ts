// @vitest-environment node
/**
 * D-48 / S3a-1: HTTP credential rules (security.md section 2; contract
 * section 11 "Phase 3a review fixes" backend item 1): Authorization schemes,
 * URL credentials on any scheme, and secret query parameters. Only the secret
 * part is redacted; the raw value never appears in findings.
 */
import { describe, expect, it } from "vitest";

import { REDACTED, scan } from "@/lib/security/secret-scanner";

/** A made-up 32-character token (contract item 1). */
const T = "9fK2mQ7xL4pR8vT1nB6cY3wZ5hJ0dS2a";
const BASIC = btoa("deploy:Zq8vN3xK1mT5pR7w");

function assertNoRawRun(raw: string, haystack: string, label: string) {
  if (raw.length < 6) {
    expect(haystack.includes(raw), label).toBe(false);
    return;
  }
  for (let i = 0; i + 6 <= raw.length; i += 1) {
    const run = raw.slice(i, i + 6);
    if (haystack.includes(run)) throw new Error(`${label}: a run of the raw value survived (offset ${i})`);
  }
}

interface Expected {
  path?: string;
  text: string;
  raw: string;
  category?: string;
  type: string;
  redacted: string;
}

function expectOne({ path = "src/app.ts", text, raw, category = "hardcoded_secret", type, redacted }: Expected) {
  const result = scan(path, text);
  expect(result.findings, text).toHaveLength(1);
  const finding = result.findings[0];
  expect(finding?.category).toBe(category);
  expect(finding?.maskedEvidence).toBe(raw.length < 12 ? type : `${type}: ${raw.slice(0, 2)}…${raw.slice(-2)}`);
  expect(result.redacted).toBe(redacted);
  assertNoRawRun(raw, result.redacted, "redacted");
  assertNoRawRun(raw, JSON.stringify(result.findings), "findings");
}

function expectNone(text: string, path = "src/app.ts") {
  const result = scan(path, text);
  expect(result.findings, text).toEqual([]);
  expect(result.redacted).toBe(text);
}

describe("D-48 rule 1: Authorization scheme", () => {
  it("TS Bearer header: only the credential is redacted", () => {
    expectOne({
      text: `const r = await fetch(url, { headers: { Authorization: "Bearer ${T}" } });`,
      raw: T,
      type: "Authorization header",
      redacted: `const r = await fetch(url, { headers: { Authorization: "Bearer ${REDACTED}" } });`,
    });
  });

  it("Python Bearer header", () => {
    expectOne({
      path: "app/client.py",
      text: `headers = {"Authorization": "Bearer ${T}"}`,
      raw: T,
      type: "Authorization header",
      redacted: `headers = {"Authorization": "Bearer ${REDACTED}"}`,
    });
  });

  it("Token scheme in an f-string", () => {
    expectOne({
      path: "app/client.py",
      text: `auth = f"Token ${T}"`,
      raw: T,
      type: "Authorization header",
      redacted: `auth = f"Token ${REDACTED}"`,
    });
  });

  it("curl in a CI workflow is ci_secret, in a script hardcoded_secret", () => {
    const line = `curl -H "Authorization: Bearer ${T}" https://api.test/deploy`;
    const redacted = `curl -H "Authorization: Bearer ${REDACTED}" https://api.test/deploy`;
    expectOne({
      path: ".github/workflows/ci.yml",
      text: `jobs:\n  deploy:\n    steps:\n      - run: ${line}\n`,
      raw: T,
      category: "ci_secret",
      type: "Authorization header",
      redacted: `jobs:\n  deploy:\n    steps:\n      - run: ${redacted}\n`,
    });
    expectOne({ path: "scripts/deploy.sh", text: line, raw: T, type: "Authorization header", redacted });
  });

  it("Basic with a base64 user:password", () => {
    expectOne({
      text: `const auth = "Basic ${BASIC}";`,
      raw: BASIC,
      type: "Authorization header",
      redacted: `const auth = "Basic ${REDACTED}";`,
    });
  });

  it("a JSON flow rendering line with a Bearer value", () => {
    expectOne({
      path: "workflow.n8n.json",
      text: `"value": "Bearer ${T}"`,
      raw: T,
      type: "Authorization header",
      redacted: `"value": "Bearer ${REDACTED}"`,
    });
  });
});

describe("D-48 rule 2: URL credentials", () => {
  it("user:password on https: only the password is redacted", () => {
    expectOne({
      text: `const u = "https://deploy:hunter2pass@api.test/v1";`,
      raw: "hunter2pass",
      type: "URL credentials",
      redacted: `const u = "https://deploy:${REDACTED}@api.test/v1";`,
    });
  });

  it("x-access-token:<token>@host", () => {
    expectOne({
      text: `const remote = "https://x-access-token:${T}@git.test/o/r.git";`,
      raw: T,
      type: "URL credentials",
      redacted: `const remote = "https://x-access-token:${REDACTED}@git.test/o/r.git";`,
    });
  });

  it("a token as the user name", () => {
    expectOne({
      text: `const u = "https://${T}@api.test/v1";`,
      raw: T,
      type: "URL credentials",
      redacted: `const u = "https://${REDACTED}@api.test/v1";`,
    });
  });

  it("redis with an empty user is db_connection_string", () => {
    expectOne({
      text: `const cache = "redis://:s3cr3tpass@cache.test:6379";`,
      raw: "s3cr3tpass",
      category: "db_connection_string",
      type: "URL credentials",
      redacted: `const cache = "redis://:${REDACTED}@cache.test:6379";`,
    });
  });
});

describe("D-48 rule 3: secret query parameters", () => {
  it("?api_key=", () => {
    expectOne({
      text: `fetch("https://api.test/v1?api_key=${T}")`,
      raw: T,
      type: "URL query secret",
      redacted: `fetch("https://api.test/v1?api_key=${REDACTED}")`,
    });
  });

  it("&access_token=", () => {
    expectOne({
      text: `const u = "https://api.test/v1?page=2&access_token=${T}";`,
      raw: T,
      type: "URL query secret",
      redacted: `const u = "https://api.test/v1?page=2&access_token=${REDACTED}";`,
    });
  });

  it("&sig=", () => {
    expectOne({
      text: `const u = "https://store.test/f?sv=2024&sig=${T}";`,
      raw: T,
      type: "URL query secret",
      redacted: `const u = "https://store.test/f?sv=2024&sig=${REDACTED}";`,
    });
  });
});

describe("D-48 negatives: no finding", () => {
  const cases = [
    "headers: { Authorization: `Bearer ${token}` }",
    'const h = "Bearer " + token;',
    "Authorization: Bearer {{ $json.token }}",
    "Authorization: Bearer <token>",
    "Authorization: Bearer YOUR_TOKEN_VALUE_1234567",
    "Authorization: bearer your_token_value_1234567",
    "Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxx",
    "Use a Bearer token in the Authorization header.",
    "Token authentication is required",
    'WWW-Authenticate: Basic realm="Access"',
    "Authorization: Basic dGVzdA==",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    'const u = "https://example.com/path";',
    'const u = "https://user@host.test/";',
    "postgres://user:${DB_PASSWORD}@db/app",
    "https://user:<password>@host.test",
    "https://host.test/a:b@c",
    "/items?page=2&sort=desc",
    "/v1?api_key=${API_KEY}",
    "/v1?token={{ $json.token }}",
    "/v1?key=abc123",
    "/v1?api_key=YOUR_API_KEY",
    "/v1?api_key=your_api_key_value_123456789",
  ];
  it.each(cases)("%s", (text) => expectNone(text));
});

describe("D-48 linear time (200 KB adversarial inputs)", () => {
  const SIZE = 200 * 1024;
  const fill = (unit: string) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
  const run = (alphabet: string) => fill(alphabet);
  const inputs: [string, string][] = [
    ["Bearer repeated", fill("Bearer ")],
    ["Bearer + one long credential", `Bearer ${run("aB3dE5gH7jK9mN1pQ")}`],
    ["a:// repeated", fill("a://")],
    ["https:// + no terminator + @ at the end", `https://${run("aB3dE5gH7jK9:")}@`],
    ["https://a: repeated", fill("https://a:")],
    ["?token= repeated", fill("?token=")],
    ["&key= + one long value", `&key=${run("aB3dE5gH7jK9mN1pQ")}`],
    // R3aR-5: the placeholder reference stripper stays linear.
    ['repeated "${}"', fill("${}")],
    ['repeated "{{}}" with no "${"', fill("{{}}")],
    ['api_key = "${a}${a}…"', `api_key = "${fill("${a}")}"`],
  ];
  it.each(inputs)("%s scans in well under 1 s", (_label, text) => {
    const started = performance.now();
    scan("src/big.ts", text);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
