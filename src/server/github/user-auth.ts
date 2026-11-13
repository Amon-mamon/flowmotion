import "server-only";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, GITHUB_WEB_URL, type FetchLike } from "@/lib/github/http";
import {
  ghAuthenticatedUserSchema,
  ghOAuthTokenResponseSchema,
  ghUserInstallationRepoSchema,
  ghUserInstallationReposSchema,
  ghUserInstallationsSchema,
  isValidRepoFullName,
  type GhAuthenticatedUser,
} from "@/schemas/github";

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

export interface UserInstallation {
  installationId: number;
  accountLogin: string;
}

export interface ListUserInstallationsInput {
  /** Short-lived user token. Discarded by the caller right after. */
  userToken: string;
  fetch?: FetchLike;
  maxPages?: number;
}

/**
 * Every installation of this App the user can access
 * (`GET /user/installations?per_page=100&page=N`, at most 10 pages, D-20).
 */
export async function listUserInstallations(
  input: ListUserInstallationsInput,
): Promise<UserInstallation[]> {
  const doFetch = input.fetch ?? fetch;
  const operation = "user installations";
  const maxPages = input.maxPages ?? 10;
  const out = new Map<number, UserInstallation>();
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await doFetch(`${GITHUB_API_URL}/user/installations?per_page=100&page=${page}`, {
      method: "GET",
      headers: { ...GITHUB_HEADERS, authorization: `Bearer ${input.userToken}` },
    });
    if (!response.ok) throw new GitHubApiError(operation, response.status);
    const parsed = ghUserInstallationsSchema.safeParse(await response.json());
    if (!parsed.success) throw new GitHubResponseError(operation);
    for (const item of parsed.data.installations) {
      out.set(item.id, { installationId: item.id, accountLogin: item.account.login });
    }
    if (page * 100 >= parsed.data.total_count || parsed.data.installations.length === 0) break;
  }
  return [...out.values()];
}

const MAX_PAGES = 10;
const PER_PAGE = 100;

/** `GET /user` with the one-time user token (D-22): GitHub id and login. */
export async function getAuthenticatedUser(
  userToken: string,
  doFetch: FetchLike = fetch,
): Promise<GhAuthenticatedUser> {
  const operation = "authenticated user";
  const response = await doFetch(`${GITHUB_API_URL}/user`, {
    method: "GET",
    headers: { ...GITHUB_HEADERS, authorization: `Bearer ${userToken}` },
  });
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  const parsed = ghAuthenticatedUserSchema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubResponseError(operation);
  return { id: parsed.data.id, login: parsed.data.login };
}

export interface AccessibleRepo {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface InstallationRepoList {
  repos: AccessibleRepo[];
  /** Items whose full_name fails the repo full name rule (dropped, never stored). */
  dropped: number;
  /** Repos beyond 10 pages (1000) that were not stored. */
  truncated: number;
}

/**
 * `GET /user/installations/{id}/repositories` (paged, at most 10 pages):
 * the repos of that installation GitHub says this user can access (D-22).
 */
export async function listUserInstallationRepos(
  userToken: string,
  installationId: number,
  doFetch: FetchLike = fetch,
): Promise<InstallationRepoList> {
  const operation = "user installation repositories";
  const repos = new Map<number, AccessibleRepo>();
  let dropped = 0;
  let total = 0;
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await doFetch(
      `${GITHUB_API_URL}/user/installations/${encodeURIComponent(String(installationId))}/repositories?per_page=${PER_PAGE}&page=${page}`,
      { method: "GET", headers: { ...GITHUB_HEADERS, authorization: `Bearer ${userToken}` } },
    );
    if (!response.ok) throw new GitHubApiError(operation, response.status);
    const parsed = ghUserInstallationReposSchema.safeParse(await response.json());
    if (!parsed.success) throw new GitHubResponseError(operation);
    total = parsed.data.total_count;
    seen += parsed.data.repositories.length;
    for (const raw of parsed.data.repositories) {
      const itemResult = ghUserInstallationRepoSchema.safeParse(raw);
      if (!itemResult.success) {
        dropped += 1;
        continue;
      }
      const item = itemResult.data;
      if (!isValidRepoFullName(item.full_name)) {
        dropped += 1;
        continue;
      }
      repos.set(item.id, {
        id: item.id,
        fullName: item.full_name,
        private: item.private,
        defaultBranch: item.default_branch,
      });
    }
    if (page * PER_PAGE >= total || parsed.data.repositories.length === 0) break;
  }
  return { repos: [...repos.values()], dropped, truncated: Math.max(0, total - seen) };
}

export interface InstallationAccess extends UserInstallation {
  repos: AccessibleRepo[];
}

export interface UserAccessSync {
  user: GhAuthenticatedUser;
  installations: InstallationAccess[];
  droppedRepos: number;
  truncatedRepos: number;
}

export interface ResolveUserAccessInput {
  clientId: string;
  clientSecret: string;
  code: string;
  fetch?: FetchLike;
}

/**
 * Callback sync (D-20, D-22): exchange `code` for a one-time user token,
 * read the GitHub user, every installation of this App the user can access,
 * and each installation's repos accessible to that user. The token never
 * leaves this function: it is not returned, stored, or logged.
 */
export async function resolveUserAccess(input: ResolveUserAccessInput): Promise<UserAccessSync> {
  const doFetch = input.fetch ?? fetch;
  const userToken = await exchangeCodeForUserToken(input);
  const user = await getAuthenticatedUser(userToken, doFetch);
  const installations = await listUserInstallations({ userToken, fetch: doFetch });
  const out: InstallationAccess[] = [];
  let droppedRepos = 0;
  let truncatedRepos = 0;
  for (const installation of installations) {
    const list = await listUserInstallationRepos(userToken, installation.installationId, doFetch);
    droppedRepos += list.dropped;
    truncatedRepos += list.truncated;
    out.push({ ...installation, repos: list.repos });
  }
  return { user, installations: out, droppedRepos, truncatedRepos };
}
