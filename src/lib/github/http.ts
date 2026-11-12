export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_WEB_URL = "https://github.com";

export const GITHUB_HEADERS: Readonly<Record<string, string>> = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "flow-motion",
};

/** Minimal fetch type so tests and the worker can inject their own. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
