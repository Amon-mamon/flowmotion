import "server-only";

import { z } from "zod";

import {
  ANALYSIS_PROVIDER_VALUES,
  DISABLED_MODEL_VALUE,
  DISABLED_PROVIDER_VALUE,
  isAnalysisModelDisabled,
} from "@/lib/analysis/model/config";
import {
  EnvValidationError,
  clientEnvSchema,
  httpUrl,
  nonEmpty,
  parseEnvWith,
  type EnvSource,
} from "@/lib/env";

/**
 * Server-only environment schema (docs/contract.md section 10, D-34 / S2b-1).
 * Kept out of `src/lib/env.ts` so no server env name or provider name reaches
 * the client bundle. Never import this module from client code.
 */

const serverEnvShape = clientEnvSchema.extend({
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
  /** AI provider kill switch (D-24): missing = disabled; other values are rejected. */
  ANALYSIS_PROVIDER: z.enum(ANALYSIS_PROVIDER_VALUES).default(DISABLED_PROVIDER_VALUE),
  /** Required only when ANALYSIS_PROVIDER=anthropic and ANALYSIS_MODEL is a model id. */
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  /** Development only (D-24, D-33): required only when ANALYSIS_PROVIDER=openrouter and AI is on. */
  OPENROUTER_API_KEY: z.string().trim().min(1).optional(),
  /** Model id, or "disabled" (the documented off value; missing = disabled). */
  ANALYSIS_MODEL: z.string().trim().min(1).default(DISABLED_MODEL_VALUE),
  APP_URL: httpUrl("APP_URL"),
  /**
   * Bearer for the worker Edge Function (D-30): random, at least 64 chars.
   * Required only when NODE_ENV=production (next dev runs the worker in-process).
   */
  WORKER_TOKEN: z.string().trim().min(64, "WORKER_TOKEN must be at least 64 characters").optional(),
});

/** Server-only variables. Never import these values into client code. */
export const serverEnvSchema = serverEnvShape.superRefine((env, ctx) => {
  // Keys are required only for the selected provider, and only while both switches are on.
  if (isAnalysisModelDisabled(env.ANALYSIS_MODEL)) return;
  if (env.ANALYSIS_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["ANTHROPIC_API_KEY"],
      message: "ANTHROPIC_API_KEY is required when ANALYSIS_PROVIDER=anthropic",
    });
  }
  if (env.ANALYSIS_PROVIDER === "openrouter" && env.OPENROUTER_API_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["OPENROUTER_API_KEY"],
      message: "OPENROUTER_API_KEY is required when ANALYSIS_PROVIDER=openrouter",
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const SERVER_ENV_NAMES = Object.keys(serverEnvShape.shape) as (keyof ServerEnv)[];

/** Pure parser for the server schema. */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const env = parseEnvWith("server", serverEnvSchema, SERVER_ENV_NAMES, source);
  if (source.NODE_ENV === "production" && env.WORKER_TOKEN === undefined) {
    throw new EnvValidationError("server", ["WORKER_TOKEN"], []);
  }
  return env;
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Server env, validated lazily at first use and cached. Throws
 * EnvValidationError listing the missing or invalid names (never values).
 */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv === undefined) {
    cachedServerEnv = parseServerEnv(process.env);
  }
  return cachedServerEnv;
}
