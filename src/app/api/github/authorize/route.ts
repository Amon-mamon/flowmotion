import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { getSessionUser } from "@/server/auth";
import { authorizeUrl } from "@/server/github/app";
import {
  GH_STATE_COOKIE,
  encodeStateCookie,
  generateInstallState,
  stateCookieOptions,
} from "@/server/github/state";
import { withApi } from "@/server/http";
import { logServerInfo } from "@/server/log";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";

/**
 * GET /api/github/authorize (D-20, D-22, D-23) — sets the fm_gh_state cookie
 * and redirects to GitHub App user authorization, which returns to the
 * installations callback with our state. Links existing installations and
 * refreshes the repo access set. Browser navigation only: it never answers
 * with JSON.
 */
export const GET = withApi("github.authorize", async (request) => {
  const env = getServerEnv();
  const user = await getSessionUser();
  if (user === null) return NextResponse.redirect(new URL("/login", env.APP_URL));

  const failure = (reason: string) => {
    logServerInfo("github.authorize", { userId: user.id, result: reason });
    return NextResponse.redirect(new URL("/dashboard?error=github", env.APP_URL));
  };

  // S11-3: a cross-site navigation must not start the link flow (a missing
  // header is allowed for older browsers).
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return failure("cross_site");

  try {
    await enforceIpLimit("github.authorize", request, RATE_LIMITS.auth);
  } catch {
    return failure("rate_limited");
  }

  const state = generateInstallState();
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set(GH_STATE_COOKIE, encodeStateCookie(user.id, state), stateCookieOptions(env.APP_URL));
  return response;
});
