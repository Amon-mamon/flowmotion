import { NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";
import { audit } from "@/server/audit";
import { getSessionUser } from "@/server/auth";
import {
  GH_STATE_COOKIE,
  readCookie,
  stateCookieOptions,
  verifyInstallState,
} from "@/server/github/state";
import { verifyInstallationOwnership } from "@/server/github/user-auth";
import { withApi } from "@/server/http";
import { upsertInstallation } from "@/server/installations";
import { logServerError, logServerInfo } from "@/server/log";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";
import { installationCallbackQuerySchema } from "@/schemas/github";

/**
 * GET /api/github/installations/callback — binds a GitHub App installation to
 * the signed-in user after proving ownership (contract section 6,
 * security.md section 3). Every failure after the session check redirects to
 * /dashboard?error=github and clears the state cookie; it never returns JSON.
 */
export const GET = withApi("github.installations.callback", async (request) => {
  const env = getServerEnv();
  const user = await getSessionUser();
  if (user === null) return NextResponse.redirect(new URL("/login", env.APP_URL));

  const finish = (response: NextResponse) => {
    // Clear the one-time state cookie on every outcome.
    response.cookies.set(GH_STATE_COOKIE, "", { ...stateCookieOptions(env.APP_URL), maxAge: 0 });
    return response;
  };
  const failure = (reason: string) => {
    logServerInfo("github.installations.callback", { userId: user.id, result: reason });
    return finish(NextResponse.redirect(new URL("/dashboard?error=github", env.APP_URL)));
  };

  try {
    try {
      await enforceIpLimit("github.installations.callback", request, RATE_LIMITS.auth);
    } catch {
      return failure("rate_limited");
    }

    const query = installationCallbackQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success) return failure("bad_query");

    const cookieValue = readCookie(request.headers.get("cookie"), GH_STATE_COOKIE);
    if (!verifyInstallState(query.data.state, cookieValue, user.id)) return failure("state_mismatch");

    let owned: { accountLogin: string } | null;
    try {
      owned = await verifyInstallationOwnership({
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
        code: query.data.code,
        installationId: query.data.installation_id,
      });
    } catch (error) {
      logServerError("github.installations.callback", error);
      return failure("ownership_check_failed");
    }
    if (owned === null) return failure("not_owner");

    const row = await upsertInstallation({
      userId: user.id,
      installationId: query.data.installation_id,
      accountLogin: owned.accountLogin,
    });
    await audit(user.id, "github.connect", row.id);
    return finish(NextResponse.redirect(new URL("/dashboard?connected=1", env.APP_URL)));
  } catch (error) {
    logServerError("github.installations.callback", error);
    return failure("internal");
  }
});
