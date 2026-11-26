import "server-only";

import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, GITHUB_WEB_URL, type FetchLike } from "@/lib/github/http";
import {
  ghAuthenticatedUserSchema,
  ghOAuthTokenResponseSchema,
  ghUserInstallationRepoSchema,
  ghUserInstallationReposSchema,
  ghUserInstallationSchema,
  ghUserInstallationsSchema,
  isValidRepoFullName,
  type GhAuthenticatedUser,
} from "@/schemas/github";

/**
 * One-time GitHub user check (docs/security.md section 3): exchange the
 * GitHub `code` for a short-lived user token, read the user, the linkable
 * installations (D-43) and their accessible repos, and discard the token.
 * Nothing here is stored.
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

export interface UserInstallation {
  installationId: number;
  accountLogin: string;
  /** GitHub account type as listed (`User`, `Organization`, `Enterprise`, ...). */
  accountType: string;
  /** GitHub id of the account the installation is on. */
  accountId: number;
}

export interface UserInstallationList {
  installations: UserInstallation[];
  /** Items that failed to parse or had a null account (count only). */
  skipped: number;
}

export interface ListUserInstallationsInput {
  /** Short-lived user token. Discarded by the caller right after. */
  userToken: string;
  fetch?: FetchLike;
  maxPages?: number;
}

/**
 * Every installation of this App GitHub lists for the user
 * (`GET /user/installations?per_page=100&page=N`, at most 10 pages, D-20).
 * Each item is parsed on its own (Phase 1.2): a malformed item or one with a
 * null account is skipped and counted. Not filtered: callers must apply
 * isLinkableInstallation before using any item (D-43).
 */
export async function listUserInstallations(
  input: ListUserInstallationsInput,
): Promise<UserInstallationList> {
  const doFetch = input.fetch ?? fetch;
  const operation = "user installations";
  const maxPages = input.maxPages ?? 10;
  const out = new Map<number, UserInstallation>();
  let skipped = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await doFetch(`${GITHUB_API_URL}/user/installations?per_page=100&page=${page}`, {
      method: "GET",
      headers: { ...GITHUB_HEADERS, authorization: `Bearer ${input.userToken}` },
    });
    if (!response.ok) throw new GitHubApiError(operation, response.status);
    const parsed = ghUserInstallationsSchema.safeParse(await response.json());
    if (!parsed.success) throw new GitHubResponseError(operation);
    for (const raw of parsed.data.installations) {
      const item = ghUserInstallationSchema.safeParse(raw);
      if (!item.success || item.data.account === null) {
        skipped += 1;
        continue;
      }
      out.set(item.data.id, {
        installationId: item.data.id,
        accountLogin: item.data.account.login,
        accountType: item.data.account.type,
        accountId: item.data.account.id,
      });
    }
    if (page * 100 >= parsed.data.total_count || parsed.data.installations.length === 0) break;
  }
  return { installations: [...out.values()], skipped };
}

/**
 * Linking rule (D-43, contract section 6): an installation may be linked only
 * when it is on the authorizing GitHub user's own account (`User` with the
 * same id as `GET /user`) or on an `Organization`. Ids only; logins can be
 * renamed and are never compared. Any other type is not linkable.
 */
export function isLinkableInstallation(
  account: { id: number; type: string } | null,
  githubUserId: number,
): boolean {
  if (account === null) return false;
  if (account.type === "Organization") return true;
  return account.type === "User" && account.id === githubUserId;
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

export interface InstallationAccess {
  installationId: number;
  accountLogin: string;
  accountType: LinkableAccountType;
  accountId: number;
  repos: AccessibleRepo[];
}

export type LinkableAccountType = "User" | "Organization";

export interface UserAccessSync {
  user: GhAuthenticatedUser;
  installations: InstallationAccess[];
  droppedRepos: number;
  truncatedRepos: number;
  /** Installations not linked: unparseable, null account, or not linkable (count only). */
  skippedInstallations: number;
}

export interface ResolveUserAccessInput {
  clientId: string;
  clientSecret: string;
  code: string;
  fetch?: FetchLike;
}

/**
 * Callback sync (D-20, D-22, D-43): exchange `code` for a one-time user
 * token, read the GitHub user, every installation of this App GitHub lists
 * for the user, keep only the linkable ones (own personal account or an
 * organization), and read each linkable installation's repos accessible to
 * that user. No repository listing is requested for a skipped installation.
 * The token never leaves this function: it is not returned, stored, or logged.
 */
export async function resolveUserAccess(input: ResolveUserAccessInput): Promise<UserAccessSync> {
  const doFetch = input.fetch ?? fetch;
  const userToken = await exchangeCodeForUserToken(input);
  const user = await getAuthenticatedUser(userToken, doFetch);
  const listed = await listUserInstallations({ userToken, fetch: doFetch });
  let skippedInstallations = listed.skipped;
  const linkable: (UserInstallation & { accountType: LinkableAccountType })[] = [];
  for (const installation of listed.installations) {
    const account = { id: installation.accountId, type: installation.accountType };
    if (!isLinkableInstallation(account, user.id)) {
      skippedInstallations += 1;
      continue;
    }
    linkable.push({
      ...installation,
      accountType: installation.accountType === "Organization" ? "Organization" : "User",
    });
  }
  const out: InstallationAccess[] = [];
  let droppedRepos = 0;
  let truncatedRepos = 0;
  for (const installation of linkable) {
    const list = await listUserInstallationRepos(userToken, installation.installationId, doFetch);
    droppedRepos += list.dropped;
    truncatedRepos += list.truncated;
    out.push({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      accountId: installation.accountId,
      repos: list.repos,
    });
  }
  return { user, installations: out, droppedRepos, truncatedRepos, skippedInstallations };
}
