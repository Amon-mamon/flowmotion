import "server-only";

import { parseServerEnv, type ServerEnv } from "@/lib/env";

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
