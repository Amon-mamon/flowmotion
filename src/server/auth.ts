import "server-only";

import type { User } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { ApiError, assertOriginAllowed } from "@/server/http";

export interface SessionUser {
  id: string;
  email: string;
}

function toSessionUser(user: User): SessionUser {
  return { id: user.id, email: user.email ?? "" };
}

/** Returns the signed-in user or null (no throw). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error !== null || user === null) return null;
  return toSessionUser(user);
}

/** Returns the signed-in user or throws `401 UNAUTHORIZED`. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user === null) throw new ApiError("UNAUTHORIZED");
  return user;
}

/** Origin check for state-changing handlers (403 FORBIDDEN on mismatch). */
export function requireSameOrigin(request: Request): void {
  assertOriginAllowed(request, getServerEnv().APP_URL);
}
