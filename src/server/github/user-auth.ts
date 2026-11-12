import "server-only";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, GITHUB_WEB_URL, type FetchLike } from "@/lib/github/http";
import { ghOAuthTokenResponseSchema, ghUserInstallationsSchema } from "@/schemas/github";

/**
 * One-time installation ownership check (docs/security.md section 3):
 * exchange the GitHub `code` for a short-lived user token, confirm the
 * installation id appears in `GET /user/installations`, take the account
 * login, and discard the token. Nothing here is stored.
 */

export interface ExchangeCodeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  fetch?: FetchLike;
}

export async function exchangeCodeForUserToken(input: ExchangeCodeInput): Promise<string> {
  const doFetch = input.fetch ?? fetch;
  const operation = "oauth code exchange";
  const response = await doFetch(`${GITHUB_WEB_URL}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "flow-motion" },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
    }),
  });
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  // GitHub answers 200 with `{ error: ... }` on a bad code; Zod rejects that.
  const parsed = ghOAuthTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubResponseError(operation);
  return parsed.data.access_token;
}

export interface FindUserInstallationInput {
  /** Short-lived user token. Discarded by the caller right after. */
  userToken: string;
  installationId: number;
  fetch?: FetchLike;
  maxPages?: number;
}

/**
 * Returns the account login when `installationId` is among the user's
 * installations, otherwise null.
 */
export async function findUserInstallation(
  input: FindUserInstallationInput,
): Promise<{ accountLogin: string } | null> {
  const doFetch = input.fetch ?? fetch;
  const operation = "user installations";
  const maxPages = input.maxPages ?? 10;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await doFetch(`${GITHUB_API_URL}/user/installations?per_page=100&page=${page}`, {
      method: "GET",
      headers: { ...GITHUB_HEADERS, authorization: `Bearer ${input.userToken}` },
    });
    if (!response.ok) throw new GitHubApiError(operation, response.status);
    const parsed = ghUserInstallationsSchema.safeParse(await response.json());
    if (!parsed.success) throw new GitHubResponseError(operation);
    const match = parsed.data.installations.find((item) => item.id === input.installationId);
    if (match !== undefined) return { accountLogin: match.account.login };
    if (page * 100 >= parsed.data.total_count || parsed.data.installations.length === 0) break;
  }
  return null;
}

export interface VerifyOwnershipInput {
  clientId: string;
  clientSecret: string;
  code: string;
  installationId: number;
  fetch?: FetchLike;
}

/** Full check; the user token never leaves this function. */
export async function verifyInstallationOwnership(
  input: VerifyOwnershipInput,
): Promise<{ accountLogin: string } | null> {
  const userToken = await exchangeCodeForUserToken(input);
  return findUserInstallation({
    userToken,
    installationId: input.installationId,
    ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
  });
}
