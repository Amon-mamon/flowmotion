import { createAppJwt } from "@/lib/github/app-jwt";
import { GitHubApiError, GitHubResponseError } from "@/lib/github/errors";
import { GITHUB_API_URL, GITHUB_HEADERS, type FetchLike } from "@/lib/github/http";
import { ghInstallationTokenResponseSchema } from "@/schemas/github";

export interface InstallationToken {
  /** Short-lived bearer token. Never store or log. */
  token: string;
  expiresAt: string;
}

export interface CreateInstallationTokenInput {
  appId: string;
  privateKeyPem: string;
  installationId: number;
  fetch?: FetchLike;
  /** Seconds since epoch, for tests. */
  now?: number;
}

/**
 * Mints an installation access token from the App private key
 * (`POST /app/installations/:id/access_tokens`). Tokens live about an hour
 * and are created on demand; only the numeric installation id is ever stored.
 */
export async function createInstallationToken(
  input: CreateInstallationTokenInput,
): Promise<InstallationToken> {
  const doFetch = input.fetch ?? fetch;
  const jwt = await createAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  const operation = "installation token";
  const response = await doFetch(
    `${GITHUB_API_URL}/app/installations/${encodeURIComponent(String(input.installationId))}/access_tokens`,
    {
      method: "POST",
      headers: { ...GITHUB_HEADERS, authorization: `Bearer ${jwt}` },
    },
  );
  if (!response.ok) throw new GitHubApiError(operation, response.status);
  const parsed = ghInstallationTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubResponseError(operation);
  return { token: parsed.data.token, expiresAt: parsed.data.expires_at };
}
