import { z } from "zod";

/**
 * Client-safe environment schema (names from docs/contract.md section 10).
 *
 * This module is imported by browser code, so it holds only NEXT_PUBLIC_ names
 * and generic parsing helpers (D-34, S2b-1). The server schema lives in the
 * server-only module `src/lib/env.server.ts`; never add a server name here.
 *
 * Values are validated lazily at first use, never at module import time, so
 * `next build` and the test suite do not require real values.
 */

export const nonEmpty = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

export const httpUrl = (name: string) =>
  nonEmpty(name).pipe(
    z.url({ protocol: /^https?$/, error: `${name} must be an http(s) URL` }),
  );

/** Client-safe variables. Only NEXT_PUBLIC_ names belong here. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export const CLIENT_ENV_NAMES = Object.keys(clientEnvSchema.shape) as (keyof ClientEnv)[];

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

/**
 * Parses `source` against an object schema (its `.shape` lists the names).
 * Empty strings count as missing. Throws EnvValidationError with names only.
 */
export function parseEnvWith<S extends z.ZodType<object>>(
  scope: "client" | "server",
  schema: S,
  names: readonly string[],
  source: EnvSource,
): z.infer<S> {
  const input: Record<string, string | undefined> = {};
  for (const name of names) {
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
  return parseEnvWith("client", clientEnvSchema, CLIENT_ENV_NAMES, source);
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
