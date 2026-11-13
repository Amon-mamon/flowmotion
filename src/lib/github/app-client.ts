import { createAppJwt } from "@/lib/github/app-jwt";
import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, type FetchLike } from "@/lib/github/http";
import { ghRepoInstallationSchema } from "@/schemas/github";

/**
 * Calls made as the GitHub App itself (App JWT, not an installation token).
 * Runtime-neutral: Web Crypto + fetch + Zod only (D-12).
 */
export interface AppClientOptions {
  appId: string;
  privateKeyPem: string;
  fetch?: FetchLike;
  /** Seconds since epoch, for tests. */
  now?: number;
}

/**
 * `GET /repos/:owner/:repo/installation` — the id of the App installation
 * that covers this repository, or null when the App is not installed on it
 * (404). An installation token can read any public repo, so this is the check
 * that a repo actually belongs to a given installation (review R1-14).
 */
export async function getRepoInstallationId(
  options: AppClientOptions,
  fullName: string,
): Promise<number | null> {
  const [owner, name, ...rest] = fullName.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    owner === "" ||
    name === "" ||
    rest.length > 0 ||
    [owner, name].some((segment) => segment === "." || segment === "..")
  ) {
    throw new GitHubApiError("repository path", 400, "Repository name must be owner/name");
  }
  const operation = "get repository installation";
  const jwt = await createAppJwt({
    appId: options.appId,
    privateKeyPem: options.privateKeyPem,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(
    `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
    { method: "GET", headers: { ...GITHUB_HEADERS, authorization: `Bearer ${jwt}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  const parsed = ghRepoInstallationSchema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubResponseError(operation);
  return parsed.data.id;
}
