/**
 * GitHub client errors. They carry the operation and HTTP status only, never
 * tokens or response bodies (docs/security.md section 3).
 */
export class GitHubApiError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number, message?: string) {
    super(message ?? `GitHub ${operation} failed with status ${status}`);
    this.name = "GitHubApiError";
    this.operation = operation;
    this.status = status;
  }
}

/** A GitHub response did not match the expected shape. */
export class GitHubResponseError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`GitHub ${operation} returned an unexpected payload`);
    this.name = "GitHubResponseError";
    this.operation = operation;
  }
}
