import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, type FetchLike } from "@/lib/github/http";
import {
  ghBlobSchema,
  ghBranchListSchema,
  ghBranchSchema,
  ghInstallationRepositoriesSchema,
  ghRepoDetailSchema,
  ghTreeResponseSchema,
  encodeBranchPath,
  isValidBranchName,
  type Branch,
  type Repo,
} from "@/schemas/github";

/**
 * Installation-token GitHub client. Runtime-neutral (fetch + Zod only) so the
 * worker can reuse it. Every response is validated before use; errors carry
 * status codes only.
 */

export const REPOS_PER_PAGE = 100;

export interface GitHubClientOptions {
  /** Installation token (bearer). Never logged. */
  token: string;
  fetch?: FetchLike;
}

export interface ListReposResult {
  repos: Repo[];
  page: number;
  hasMore: boolean;
}

export interface RepoTree {
  /** Tree sha (the commit's root tree). */
  sha: string;
  /** Blob paths only; directories are dropped. Never file contents. */
  paths: string[];
  /** Whether GitHub truncated the listing (over 100k entries / 7 MB). */
  truncated: boolean;
}

async function gitHubGet(client: GitHubClientOptions, operation: string, path: string) {
  const doFetch = client.fetch ?? fetch;
  const response = await doFetch(`${GITHUB_API_URL}${path}`, {
    method: "GET",
    headers: { ...GITHUB_HEADERS, authorization: `Bearer ${client.token}` },
  });
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  return response.json() as Promise<unknown>;
}

function toRepo(item: { full_name: string; default_branch: string; private: boolean }): Repo {
  return { fullName: item.full_name, defaultBranch: item.default_branch, private: item.private };
}

/** `GET /installation/repositories?per_page=100&page=N` */
export async function listInstallationRepos(
  client: GitHubClientOptions,
  page: number,
): Promise<ListReposResult> {
  const operation = "list installation repositories";
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const json = await gitHubGet(
    client,
    operation,
    `/installation/repositories?per_page=${REPOS_PER_PAGE}&page=${safePage}`,
  );
  const parsed = ghInstallationRepositoriesSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  const repos = parsed.data.repositories.map(toRepo);
  const hasMore = safePage * REPOS_PER_PAGE < parsed.data.total_count && repos.length > 0;
  return { repos, page: safePage, hasMore };
}

/** `GET /repos/:owner/:repo` */
/** A repo as read with an installation token, plus GitHub's numeric repo id (D-22). */
export type RepoWithId = Repo & { id: number };

export async function getRepo(client: GitHubClientOptions, fullName: string): Promise<RepoWithId> {
  const operation = "get repository";
  const json = await gitHubGet(client, operation, `/repos/${encodeRepoPath(fullName)}`);
  const parsed = ghRepoDetailSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  return { ...toRepo(parsed.data), id: parsed.data.id };
}

/**
 * One repository as seen by an installation token: `GET /repos/:owner/:repo`.
 * 200 means the installation can access it; 404 means it cannot (or it does
 * not exist) and returns null. One call, no paging cap.
 */
export async function getInstallationRepo(
  client: GitHubClientOptions,
  fullName: string,
): Promise<RepoWithId | null> {
  try {
    return await getRepo(client, fullName);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

/** `GET /repos/:owner/:repo/branches/:branch` → head commit sha. */
export async function getBranchHeadSha(
  client: GitHubClientOptions,
  fullName: string,
  branch: string,
): Promise<string> {
  const operation = "get branch";
  const json = await gitHubGet(
    client,
    operation,
    `/repos/${encodeRepoPath(fullName)}/branches/${encodeBranchPath(branch)}`,
  );
  const parsed = ghBranchSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  return parsed.data.commit.sha;
}

export const BRANCHES_PER_PAGE = 100;

export interface ListBranchesResult {
  branches: Branch[];
  hasMore: boolean;
  /** Items whose name fails branchNameSchema (dropped, R11-6). */
  skipped: number;
}

/**
 * `GET /repos/:owner/:repo/branches?per_page=100&page=N` in GitHub's order.
 * Each item is Zod-parsed as `{ name, protected }`; a malformed item fails
 * the whole page. `hasMore` follows the Link header's `rel="next"` when
 * present, otherwise a full page means there may be more.
 */
export async function listRepoBranches(
  client: GitHubClientOptions,
  fullName: string,
  page: number,
): Promise<ListBranchesResult> {
  const operation = "list branches";
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const doFetch = client.fetch ?? fetch;
  const response = await doFetch(
    `${GITHUB_API_URL}/repos/${encodeRepoPath(fullName)}/branches?per_page=${BRANCHES_PER_PAGE}&page=${safePage}`,
    { method: "GET", headers: { ...GITHUB_HEADERS, authorization: `Bearer ${client.token}` } },
  );
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  const parsed = ghBranchListSchema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubResponseError(operation);
  // R11-6: a name our rules reject is skipped, not a whole-page failure.
  const branches = parsed.data
    .filter((item) => isValidBranchName(item.name))
    .map((item) => ({ name: item.name, protected: item.protected }));
  const skipped = parsed.data.length - branches.length;
  const link = response.headers.get("link");
  const hasMore =
    link !== null ? /<[^>]*>;\s*rel="next"/.test(link) : parsed.data.length === BRANCHES_PER_PAGE;
  return { branches, hasMore, skipped };
}

/**
 * `GET /repos/:owner/:repo/branches/:branch` (per-segment encoding) →
 * GitHub's own `name` and head sha, or null on 404.
 */
export async function getBranch(
  client: GitHubClientOptions,
  fullName: string,
  branch: string,
): Promise<{ name: string; headSha: string } | null> {
  const operation = "get branch";
  let json: unknown;
  try {
    json = await gitHubGet(
      client,
      operation,
      `/repos/${encodeRepoPath(fullName)}/branches/${encodeBranchPath(branch)}`,
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
  const parsed = ghBranchSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  if (!isValidBranchName(parsed.data.name)) return null;
  return { name: parsed.data.name, headSha: parsed.data.commit.sha };
}

/**
 * `GET /repos/:owner/:repo/git/trees/:ref?recursive=1` — file paths only.
 * Used by the Phase 2 validity check and path policy. No content is fetched.
 */
export async function fetchRepoTree(
  client: GitHubClientOptions,
  fullName: string,
  ref: string,
): Promise<RepoTree> {
  const operation = "get tree";
  const json = await gitHubGet(
    client,
    operation,
    `/repos/${encodeRepoPath(fullName)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  const parsed = ghTreeResponseSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  return {
    sha: parsed.data.sha,
    paths: parsed.data.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path),
    truncated: parsed.data.truncated,
  };
}

export interface RepoTreeBlob {
  path: string;
  sha: string;
  size: number;
}

export interface RepoTreeBlobs {
  sha: string;
  blobs: RepoTreeBlob[];
  truncated: boolean;
}

/**
 * Same call as `fetchRepoTree` but keeps each blob's sha and size, which the
 * path policy (size cap) and the blob fetch need. Still paths only, no content.
 */
export async function fetchRepoTreeBlobs(
  client: GitHubClientOptions,
  fullName: string,
  ref: string,
): Promise<RepoTreeBlobs> {
  const operation = "get tree";
  const json = await gitHubGet(
    client,
    operation,
    `/repos/${encodeRepoPath(fullName)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  const parsed = ghTreeResponseSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  return {
    sha: parsed.data.sha,
    blobs: parsed.data.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 })),
    truncated: parsed.data.truncated,
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * `GET /repos/:owner/:repo/git/blobs/:sha` → raw bytes. Callers must run the
 * path policy before this and the secret scanner right after it.
 */
export async function getBlobBytes(
  client: GitHubClientOptions,
  fullName: string,
  sha: string,
): Promise<Uint8Array> {
  const operation = "get blob";
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new GitHubApiError(operation, 400, "Invalid blob sha");
  const json = await gitHubGet(client, operation, `/repos/${encodeRepoPath(fullName)}/git/blobs/${sha}`);
  const parsed = ghBlobSchema.safeParse(json);
  if (!parsed.success || parsed.data.encoding !== "base64") throw new GitHubResponseError(operation);
  try {
    return base64ToBytes(parsed.data.content);
  } catch {
    throw new GitHubResponseError(operation);
  }
}

function encodeRepoPath(fullName: string): string {
  const [owner, name] = fullName.split("/");
  if (owner === undefined || name === undefined || owner === "" || name === "") {
    throw new GitHubApiError("repository path", 400, "Repository name must be owner/name");
  }
  // S11-4 defence in depth: "." / ".." would be resolved as URL dot segments.
  if ([owner, name].some((segment) => segment === "." || segment === "..")) {
    throw new GitHubApiError("repository path", 400, "Repository name must be owner/name");
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
