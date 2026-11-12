import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import { ApiError, withApi } from "@/server/http";
import { logServerError } from "@/server/log";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";

const querySchema = z.object({ code: z.string().min(1).max(512) });

/**
 * GET /api/auth/callback — Supabase PKCE code exchange (contract section 3).
 * Success → /dashboard, failure → /login?error=auth. Never follows `next`.
 */
export const GET = withApi("auth.callback", async (request) => {
  const env = getServerEnv();
  const toDashboard = NextResponse.redirect(new URL("/dashboard", env.APP_URL));
  const toLogin = NextResponse.redirect(new URL("/login?error=auth", env.APP_URL));

  try {
    await enforceIpLimit("auth.callback", request, RATE_LIMITS.auth);
  } catch (error) {
    if (error instanceof ApiError && error.code === "RATE_LIMITED") return toLogin;
    throw error;
  }

  const query = querySchema.safeParse({ code: new URL(request.url).searchParams.get("code") ?? "" });
  if (!query.success) return toLogin;

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(query.data.code);
  if (error !== null) {
    logServerError("auth.callback", { name: "AuthError", status: error.status ?? 0 });
    return toLogin;
  }
  return toDashboard;
});
