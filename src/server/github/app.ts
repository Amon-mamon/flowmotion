import "server-only";

import { getServerEnv } from "@/lib/env.server";
import { getRepoInstallationId } from "@/lib/github/app-client";
import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { createInstallationToken, type InstallationToken } from "@/lib/github/installation-token";
import { ApiError } from "@/server/http";
import { logServerError } from "@/server/log";

/**
 * Maps GitHub client failures to API errors. A 401/403/404 while minting an
 * installation token means the installation was removed on GitHub; the user
 * must reconnect. Everything else is an INTERNAL error with a generic message.
 */
export function mapGitHubError(scope: string, error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof GitHubApiError) {
    logServerError(scope, error);
    if (error.operation === "installation token" && [401, 403, 404].includes(error.status)) {
      return new ApiError(
        "VALIDATION_ERROR",
        "This GitHub installation is no longer available. Reconnect GitHub and try again.",
      );
    }
    return new ApiError("INTERNAL", "GitHub request failed. Please try again.");
  }
  if (error instanceof GitHubResponseError) {
    logServerError(scope, error);
    return new ApiError("INTERNAL", "GitHub returned an unexpected response.");
  }
  logServerError(scope, error);
  return new ApiError("INTERNAL");
}

/** Mints a short-lived installation token from the configured App key. */
export async function mintInstallationToken(installationId: number): Promise<InstallationToken> {
  const env = getServerEnv();
  return createInstallationToken({
    appId: env.GITHUB_APP_ID,
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
    installationId,
  });
}

/** GitHub App installation page for the configured slug. */
export function installUrl(state: string): string {
  const env = getServerEnv();
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Path the callback falls back to when GitHub returns without our state (D-20). */
export const AUTHORIZE_PATH = "/api/github/authorize";
export const INSTALLATION_CALLBACK_PATH = "/api/github/installations/callback";

/**
 * GitHub App user authorization URL (no scopes) that returns to our
 * installations callback with `state` (contract section 6, D-20).
 */
export function authorizeUrl(state: string): string {
  const env = getServerEnv();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", new URL(INSTALLATION_CALLBACK_PATH, env.APP_URL).toString());
  return url.toString();
}

/** Installation id that covers `fullName`, or null when the App is not installed on it. */
export async function repoInstallationId(fullName: string): Promise<number | null> {
  const env = getServerEnv();
  return getRepoInstallationId(
    { appId: env.GITHUB_APP_ID, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY },
    fullName,
  );
}
