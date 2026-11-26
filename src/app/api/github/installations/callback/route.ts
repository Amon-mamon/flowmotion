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
import { resolveUserAccess, type UserAccessSync } from "@/server/github/user-auth";
import { withApi } from "@/server/http";
import {
  GitHubAccountInUseError,
  GitHubAccountMismatchError,
  linkGithubInstallations,
} from "@/server/installations";
import { logServerError, logServerInfo } from "@/server/log";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";
import { installationCallbackQuerySchema } from "@/schemas/github";

/**
 * GET /api/github/installations/callback (contract section 6, D-20, D-22, D-23).
 *  1. No `state`: never bind and never use `code`; redirect to
 *     /dashboard?link=github, where the user clicks "Link existing
 *     installation" (S11-3).
 *  2. `state` present: verify it against the fm_gh_state cookie (user and
 *     state, constant time); with the one-time user token read the GitHub
 *     user, the linkable installations of this App (own personal account
 *     or an organization, D-43), and each linkable installation's repos
 *     accessible to that user; a given `installation_id` must be in the
 *     linkable list; then one atomic `link_github_installations()` call
 *     replaces the access sets. A different GitHub account than the one
 *     already linked binds nothing (?error=github_account); a GitHub account
 *     held by another Flow Motion account binds nothing (?error=github_in_use,
 *     D-44).
 *  3. Any other failure → /dashboard?error=github, never JSON.
 * The state cookie is cleared on every outcome, including signed out (R11-7).
 * The user token never leaves resolveUserAccess and is never logged.
 */
export const GET = withApi("github.installations.callback", async (request) => {
  const env = getServerEnv();
  const finish = (response: NextResponse) => {
    response.cookies.set(GH_STATE_COOKIE, "", { ...stateCookieOptions(env.APP_URL), maxAge: 0 });
    return response;
  };

  const user = await getSessionUser();
  if (user === null) return finish(NextResponse.redirect(new URL("/login", env.APP_URL)));

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

    const params = new URL(request.url).searchParams;
    const rawState = params.get("state");
    if (rawState === null || rawState === "") {
      logServerInfo("github.installations.callback", { userId: user.id, result: "no_state_link_prompt" });
      return finish(NextResponse.redirect(new URL("/dashboard?link=github", env.APP_URL)));
    }

    const query = installationCallbackQuerySchema.safeParse(Object.fromEntries(params.entries()));
    if (!query.success) return failure("bad_query");

    const cookieValue = readCookie(request.headers.get("cookie"), GH_STATE_COOKIE);
    if (!verifyInstallState(query.data.state, cookieValue, user.id)) return failure("state_mismatch");

    let sync: UserAccessSync;
    try {
      sync = await resolveUserAccess({
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
        code: query.data.code,
      });
    } catch (error) {
      logServerError("github.installations.callback", error);
      return failure("ownership_check_failed");
    }

    // `sync.installations` holds only linkable installations (D-43).
    const requested = query.data.installation_id;
    if (requested !== undefined && !sync.installations.some((item) => item.installationId === requested)) {
      return failure("not_owner");
    }

    let added: number[];
    try {
      // Called with [] too: that clears this user's sets.
      added = await linkGithubInstallations({
        userId: user.id,
        githubUserId: sync.user.id,
        githubUserLogin: sync.user.login,
        installations: sync.installations,
      });
    } catch (error) {
      if (error instanceof GitHubAccountMismatchError) {
        logServerInfo("github.installations.callback", { userId: user.id, result: "github_account_mismatch" });
        return finish(NextResponse.redirect(new URL("/dashboard?error=github_account", env.APP_URL)));
      }
      if (error instanceof GitHubAccountInUseError) {
        logServerInfo("github.installations.callback", { userId: user.id, result: "github_in_use" });
        return finish(NextResponse.redirect(new URL("/dashboard?error=github_in_use", env.APP_URL)));
      }
      throw error;
    }

    for (const installationId of added) {
      await audit(user.id, "github.connect", String(installationId));
    }
    await audit(user.id, "github.sync", String(sync.installations.length));
    logServerInfo("github.installations.callback", {
      userId: user.id,
      result: sync.installations.length === 0 ? "none" : "connected",
      linked: sync.installations.length,
      added: added.length,
      repos: sync.installations.reduce((sum, item) => sum + item.repos.length, 0),
      droppedRepos: sync.droppedRepos,
      truncatedRepos: sync.truncatedRepos,
      skipped: sync.skippedInstallations,
    });

    if (sync.installations.length === 0) {
      return finish(NextResponse.redirect(new URL("/dashboard?error=github_none", env.APP_URL)));
    }
    return finish(NextResponse.redirect(new URL("/dashboard?connected=1", env.APP_URL)));
  } catch (error) {
    logServerError("github.installations.callback", error);
    return failure("internal");
  }
});
