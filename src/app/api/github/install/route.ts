import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { getSessionUser } from "@/server/auth";
import { installUrl } from "@/server/github/app";
import {
  GH_STATE_COOKIE,
  encodeStateCookie,
  generateInstallState,
  stateCookieOptions,
} from "@/server/github/state";
import { withApi } from "@/server/http";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";

/**
 * GET /api/github/install — sets the fm_gh_state cookie and redirects to the
 * GitHub App installation page (contract section 6, security.md section 3).
 */
export const GET = withApi("github.install", async (request) => {
  const env = getServerEnv();
  const user = await getSessionUser();
  if (user === null) return NextResponse.redirect(new URL("/login", env.APP_URL));

  try {
    await enforceIpLimit("github.install", request, RATE_LIMITS.auth);
  } catch {
    // S11-5: browser navigation, never JSON.
    return NextResponse.redirect(new URL("/dashboard?error=github", env.APP_URL));
  }

  const state = generateInstallState();
  const response = NextResponse.redirect(installUrl(state));
  response.cookies.set(GH_STATE_COOKIE, encodeStateCookie(user.id, state), stateCookieOptions(env.APP_URL));
  return response;
});
