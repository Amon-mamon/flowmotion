import { z } from "zod";

/**
 * Environment variable schemas (names from docs/contract.md section 10).
 *
 * Values are validated lazily at first use, never at module import time, so
 * `next build` and the test suite do not require real values. Server values
 * are only reachable through `src/lib/env.server.ts` (server-only).
 */

const nonEmpty = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

const httpUrl = (name: string) =>
  nonEmpty(name).pipe(
    z.url({ protocol: /^https?$/, error: `${name} must be an http(s) URL` }),
  );

/** Client-safe variables. Only NEXT_PUBLIC_ names belong here. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
});

/** Server-only variables. Never import these values into client code. */
export const serverEnvSchema = clientEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
  GITHUB_APP_ID: nonEmpty("GITHUB_APP_ID").regex(/^\d+$/, "GITHUB_APP_ID must be numeric"),
  GITHUB_APP_SLUG: nonEmpty("GITHUB_APP_SLUG").regex(
    /^[a-z0-9-]+$/,
    "GITHUB_APP_SLUG must be a GitHub app slug",
  ),
  GITHUB_APP_CLIENT_ID: nonEmpty("GITHUB_APP_CLIENT_ID"),
  GITHUB_APP_CLIENT_SECRET: nonEmpty("GITHUB_APP_CLIENT_SECRET"),
  GITHUB_APP_PRIVATE_KEY: nonEmpty("GITHUB_APP_PRIVATE_KEY"),
  GITHUB_WEBHOOK_SECRET: nonEmpty("GITHUB_WEBHOOK_SECRET"),
  ANTHROPIC_API_KEY: nonEmpty("ANTHROPIC_API_KEY"),
  ANALYSIS_MODEL: nonEmpty("ANALYSIS_MODEL"),
  APP_URL: httpUrl("APP_URL"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const CLIENT_ENV_NAMES = Object.keys(clientEnvSchema.shape) as (keyof ClientEnv)[];
export const SERVER_ENV_NAMES = Object.keys(serverEnvSchema.shape) as (keyof ServerEnv)[];

/** Thrown when validation fails. Lists variable names only, never values. */
export class EnvValidationError extends Error {
  readonly missing: string[];
  readonly invalid: string[];

  constructor(scope: "client" | "server", missing: string[], invalid: string[]) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (invalid.length > 0) parts.push(`invalid: ${invalid.join(", ")}`);
    super(
      `Invalid ${scope} environment (${parts.join("; ")}). ` +
        "Copy .env.example to .env.local and fill in every value.",
    );
    this.name = "EnvValidationError";
    this.missing = missing;
    this.invalid = invalid;
  }
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

function parseWith<T extends z.ZodObject>(
  scope: "client" | "server",
  schema: T,
  source: EnvSource,
): z.infer<T> {
  const input: Record<string, string | undefined> = {};
  for (const name of Object.keys(schema.shape)) {
    const value = source[name];
    // Treat empty strings as missing so an empty placeholder is reported clearly.
    input[name] = value === undefined || value.trim() === "" ? undefined : value;
  }
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const missing = new Set<string>();
  const invalid = new Set<string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? "");
    if (name === "") continue;
    if (input[name] === undefined) missing.add(name);
    else invalid.add(name);
  }
  throw new EnvValidationError(scope, [...missing].sort(), [...invalid].sort());
}

/** Pure parser for the client schema. Safe to call anywhere. */
export function parseClientEnv(source: EnvSource): ClientEnv {
  return parseWith("client", clientEnvSchema, source);
}

/** Pure parser for the server schema. Do not call from client code. */
export function parseServerEnv(source: EnvSource): ServerEnv {
  return parseWith("server", serverEnvSchema, source);
}

let cachedClientEnv: ClientEnv | undefined;

/**
 * Client-safe env, validated at first use. NEXT_PUBLIC_ values are inlined by
 * Next.js only when referenced as `process.env.NAME` literally, hence the
 * explicit object below.
 */
export function getClientEnv(): ClientEnv {
  if (cachedClientEnv === undefined) {
    cachedClientEnv = parseClientEnv({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return cachedClientEnv;
}
