import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_ENV_NAMES,
  EnvValidationError,
  getClientEnv,
  parseClientEnv,
} from "@/lib/env";
import { SERVER_ENV_NAMES, parseServerEnv } from "@/lib/env.server";

const validClient = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

const validServer = {
  ...validClient,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "flow-motion-dev",
  GITHUB_APP_CLIENT_ID: "Iv1.abc",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  ANALYSIS_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "sk-ant-test",
  ANALYSIS_MODEL: "claude-sonnet-4-5",
  APP_URL: "http://localhost:3000",
};

/** docs/contract.md section 10, verbatim. */
const CONTRACT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "ANALYSIS_MODEL",
  "APP_URL",
  "WORKER_TOKEN",
  "ANALYSIS_PROVIDER",
  "OPENROUTER_API_KEY",
];

const AI_NAMES = ["ANTHROPIC_API_KEY", "ANALYSIS_MODEL", "WORKER_TOKEN", "ANALYSIS_PROVIDER", "OPENROUTER_API_KEY"];

function envExampleKeys(): string[] {
  // vitest runs with the project root as cwd.
  const path = resolve(process.cwd(), ".env.example");
  const keys: string[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (match?.[1] !== undefined) keys.push(match[1]);
  }
  return keys;
}

describe("env schema", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("covers exactly the names in contract section 10", () => {
    expect([...SERVER_ENV_NAMES].sort()).toEqual([...CONTRACT_NAMES].sort());
  });

  it("client schema only contains NEXT_PUBLIC_ names", () => {
    expect(CLIENT_ENV_NAMES.length).toBeGreaterThan(0);
    for (const name of CLIENT_ENV_NAMES) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(true);
    }
    expect(CLIENT_ENV_NAMES).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it(".env.example keys equal the union of client and server schema keys (drift guard)", () => {
    const union = new Set<string>([...CLIENT_ENV_NAMES, ...SERVER_ENV_NAMES]);
    const keys = envExampleKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...union].sort());
  });

  it("parses a valid server set", () => {
    const env = parseServerEnv(validServer);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.GITHUB_APP_ID).toBe("123456");
    expect(env.GITHUB_APP_SLUG).toBe("flow-motion-dev");
  });

  it("parses a NEXT_PUBLIC-only set with the client schema", () => {
    const env = parseClientEnv(validClient);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
    // Server names are not required for the client schema.
    expect(() => parseClientEnv(validClient)).not.toThrow();
  });

  it("client schema rejects a non-http Supabase URL", () => {
    let caught: unknown;
    try {
      parseClientEnv({ ...validClient, NEXT_PUBLIC_SUPABASE_URL: "ftp://x" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).invalid).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("getClientEnv reads process.env and fails fast with names only", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    let caught: unknown;
    try {
      getClientEnv();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", validClient.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", validClient.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const env = getClientEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(validClient.NEXT_PUBLIC_SUPABASE_URL);
    // Cached after the first successful parse.
    expect(getClientEnv()).toBe(env);
  });

  it("lists every missing name when the set is empty", () => {
    let caught: unknown;
    try {
      parseServerEnv({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    // The AI names are optional: a missing ANALYSIS_MODEL means disabled (D-16).
    const required = CONTRACT_NAMES.filter((name) => !AI_NAMES.includes(name));
    expect(err.missing).toEqual([...required].sort());
    expect(err.invalid).toEqual([]);
    for (const name of required) {
      expect(err.message).toContain(name);
    }
  });

  it("treats empty strings as missing and reports invalid values separately", () => {
    let caught: unknown;
    try {
      parseServerEnv({ ...validServer, ANTHROPIC_API_KEY: "   ", APP_URL: "not-a-url" });
    } catch (error) {
      caught = error;
    }
    const err = caught as EnvValidationError;
    expect(err).toBeInstanceOf(EnvValidationError);
    expect(err.missing).toEqual(["ANTHROPIC_API_KEY"]);
    expect(err.invalid).toEqual(["APP_URL"]);
  });

  it("AI kill switch: ANALYSIS_MODEL=disabled does not require ANTHROPIC_API_KEY", () => {
    const { ANTHROPIC_API_KEY: _key, ...rest } = validServer;
    void _key;
    const env = parseServerEnv({ ...rest, ANALYSIS_MODEL: "disabled" });
    expect(env.ANALYSIS_MODEL).toBe("disabled");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(parseServerEnv({ ...rest, ANALYSIS_MODEL: "DISABLED", ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("AI kill switch: a missing ANALYSIS_MODEL means disabled", () => {
    const { ANTHROPIC_API_KEY: _key, ANALYSIS_MODEL: _model, ...rest } = validServer;
    void _key;
    void _model;
    expect(parseServerEnv(rest).ANALYSIS_MODEL).toBe("disabled");
  });

  it("AI kill switch: a model id requires ANTHROPIC_API_KEY (name only in the error)", () => {
    let caught: unknown;
    try {
      parseServerEnv({ ...validServer, ANTHROPIC_API_KEY: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).missing).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("ANALYSIS_PROVIDER: missing = disabled, unknown values rejected (D-24)", () => {
    const { ANALYSIS_PROVIDER: _p, ...rest } = validServer;
    void _p;
    expect(parseServerEnv(rest).ANALYSIS_PROVIDER).toBe("disabled");
    let caught: unknown;
    try {
      parseServerEnv({ ...validServer, ANALYSIS_PROVIDER: "gemini" });
    } catch (error) {
      caught = error;
    }
    expect((caught as EnvValidationError).invalid).toEqual(["ANALYSIS_PROVIDER"]);
    expect((caught as Error).message).not.toContain("gemini");
  });

  it("keys are required only for the selected provider while AI is on", () => {
    const { ANTHROPIC_API_KEY: _k, ...noAnthropic } = validServer;
    void _k;
    // openrouter needs OPENROUTER_API_KEY, not ANTHROPIC_API_KEY.
    let caught: unknown;
    try {
      parseServerEnv({ ...noAnthropic, ANALYSIS_PROVIDER: "openrouter" });
    } catch (error) {
      caught = error;
    }
    expect((caught as EnvValidationError).missing).toEqual(["OPENROUTER_API_KEY"]);
    const env = parseServerEnv({ ...noAnthropic, ANALYSIS_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-test" });
    expect(env.OPENROUTER_API_KEY).toBe("sk-or-test");
    // anthropic needs no OpenRouter key; disabled needs no key at all.
    expect(parseServerEnv(validServer).OPENROUTER_API_KEY).toBeUndefined();
    expect(parseServerEnv({ ...noAnthropic, ANALYSIS_PROVIDER: "disabled" }).ANALYSIS_PROVIDER).toBe("disabled");
    expect(parseServerEnv({ ...noAnthropic, ANALYSIS_PROVIDER: "openrouter", ANALYSIS_MODEL: "disabled" }).ANALYSIS_MODEL).toBe("disabled");
  });

  it(".env.example ships with AI disabled", () => {
    const text = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(text).toMatch(/^ANALYSIS_MODEL=disabled$/m);
    expect(text).toMatch(/^ANTHROPIC_API_KEY=$/m);
    expect(text).toMatch(/^ANALYSIS_PROVIDER=disabled$/m);
    expect(text).toMatch(/^OPENROUTER_API_KEY=$/m);
    expect(text).toContain("development only, owner test repos only (security.md section 3)");
  });

  it("WORKER_TOKEN: optional outside production, required (min 64) in production", () => {
    expect(parseServerEnv(validServer).WORKER_TOKEN).toBeUndefined();
    let caught: unknown;
    try {
      parseServerEnv({ ...validServer, NODE_ENV: "production" });
    } catch (error) {
      caught = error;
    }
    expect((caught as EnvValidationError).missing).toEqual(["WORKER_TOKEN"]);
    expect(() => parseServerEnv({ ...validServer, NODE_ENV: "production", WORKER_TOKEN: "short" })).toThrow(EnvValidationError);
    const token = "a1".repeat(32);
    expect(parseServerEnv({ ...validServer, NODE_ENV: "production", WORKER_TOKEN: token }).WORKER_TOKEN).toBe(token);
  });

  it("never includes values in the error message", () => {
    let message = "";
    try {
      parseServerEnv({ ...validServer, SUPABASE_SERVICE_ROLE_KEY: "", APP_URL: "ftp://secret-host" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("secret-host");
    expect(message).not.toContain("anon-key");
  });

  it("rejects a non-numeric GITHUB_APP_ID and a malformed GITHUB_APP_SLUG", () => {
    expect(() => parseServerEnv({ ...validServer, GITHUB_APP_ID: "abc" })).toThrow(
      EnvValidationError,
    );
    expect(() => parseServerEnv({ ...validServer, GITHUB_APP_SLUG: "Not A Slug" })).toThrow(
      EnvValidationError,
    );
  });
});

describe("env schema split (D-34, S2b-1)", () => {
  const clientSource = readFileSync(resolve(process.cwd(), "src/lib/env.ts"), "utf8");
  const serverSource = readFileSync(resolve(process.cwd(), "src/lib/env.server.ts"), "utf8");

  it("src/lib/env.ts (client-safe) holds no server env name, provider name, or model config import", () => {
    expect(clientSource).not.toContain("@/lib/analysis/model/config");
    expect(clientSource).not.toMatch(/import\s+["']server-only["']/);
    for (const banned of ["OPENROUTER", "ANTHROPIC", "SERVICE_ROLE", "WORKER_TOKEN", "GITHUB_APP_PRIVATE_KEY", "openrouter"]) {
      expect(clientSource).not.toContain(banned);
    }
    for (const name of SERVER_ENV_NAMES) {
      if (name.startsWith("NEXT_PUBLIC_")) continue;
      expect(clientSource).not.toContain(name);
    }
  });

  it("src/lib/env.server.ts is server-only and owns the server schema", () => {
    expect(serverSource).toMatch(/^import "server-only";/);
    expect(serverSource).toContain("export const serverEnvSchema");
    expect(serverSource).toContain("@/lib/analysis/model/config");
  });
});
