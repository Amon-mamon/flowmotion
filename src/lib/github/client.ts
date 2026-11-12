import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, type FetchLike } from "@/lib/github/http";
import {
  ghBranchSchema,
  ghInstallationRepositoriesSchema,
  ghRepoDetailSchema,
  ghTreeResponseSchema,
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
export async function getRepo(client: GitHubClientOptions, fullName: string): Promise<Repo> {
  const operation = "get repository";
  const json = await gitHubGet(client, operation, `/repos/${encodeRepoPath(fullName)}`);
  const parsed = ghRepoDetailSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  return toRepo(parsed.data);
}

/**
 * One repository as seen by an installation token: `GET /repos/:owner/:repo`.
 * 200 means the installation can access it; 404 means it cannot (or it does
 * not exist) and returns null. One call, no paging cap.
 */
export async function getInstallationRepo(
  client: GitHubClientOptions,
  fullName: string,
): Promise<Repo | null> {
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
    `/repos/${encodeRepoPath(fullName)}/branches/${encodeURIComponent(branch)}`,
  );
  const parsed = ghBranchSchema.safeParse(json);
  if (!parsed.success) throw new GitHubResponseError(operation);
  return parsed.data.commit.sha;
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

function encodeRepoPath(fullName: string): string {
  const [owner, name] = fullName.split("/");
  if (owner === undefined || name === undefined || owner === "" || name === "") {
    throw new GitHubApiError("repository path", 400, "Repository name must be owner/name");
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
