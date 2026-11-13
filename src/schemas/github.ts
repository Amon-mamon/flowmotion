import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "@/schemas/api";

/** "owner/name" as GitHub formats it. */
/**
 * "owner/name" (contract section 6, D-23 / S11-4): owner is letters, digits
 * and "-"; name is letters, digits, ".", "_" and "-"; at most 140 chars;
 * neither segment may be "." or "..".
 */
export function isValidRepoFullName(value: string): boolean {
  if (value.length > 140) return false;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

export const repoFullNameSchema = z
  .string()
  .refine(isValidRepoFullName, { message: "Expected owner/name" });

/**
 * Git branch name (contract section 6, Phase 1.1; `git check-ref-format
 * --branch` rules). Not trimmed: surrounding whitespace is already invalid.
 */
export function isValidBranchName(name: string): boolean {
  if (name.length < 1 || name.length > 255) return false;
  if (new TextEncoder().encode(name).length > 255) return false;
  if (name === "@") return false;
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(name)) return false;
  if (name.includes("..") || name.includes("@{") || name.includes("//")) return false;
  if (name.startsWith("-") || name.startsWith("/")) return false;
  if (name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return false;
  return name.split("/").every((segment) => !segment.startsWith(".") && !segment.endsWith(".lock"));
}

export const branchNameSchema = z
  .string()
  .refine(isValidBranchName, { message: "Invalid branch name" });
export type BranchName = z.infer<typeof branchNameSchema>;

/**
 * Encodes a branch for a GitHub API path per segment, so `/` stays a literal
 * separator (`feature/x` → `feature/x`, `a#b` → `a%23b`).
 */
export function encodeBranchPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

// --- DTOs (docs/contract.md section 6) -------------------------------------

export const installationSchema = z.object({
  /** github_installations.id (uuid). */
  id: uuidSchema,
  /** GitHub's numeric installation id. */
  installationId: z.number().int().positive(),
  accountLogin: z.string(),
  createdAt: isoDateTimeSchema,
  /** GitHub account that linked this row; null on rows linked before D-22. */
  githubUserLogin: z.string().nullable(),
  /** Last repo access sync; null = never synced or cleared. */
  reposSyncedAt: isoDateTimeSchema.nullable(),
  /** True when reposSyncedAt is null or older than 24 h (D-22). */
  needsRefresh: z.boolean(),
});
export type Installation = z.infer<typeof installationSchema>;

export const repoSchema = z.object({
  fullName: repoFullNameSchema,
  defaultBranch: z.string(),
  private: z.boolean(),
});
export type Repo = z.infer<typeof repoSchema>;

export const installationsResponseSchema = z.object({
  installations: z.array(installationSchema),
});
export type InstallationsResponse = z.infer<typeof installationsResponseSchema>;

export const reposResponseSchema = z.object({
  repos: z.array(repoSchema),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
});
export type ReposResponse = z.infer<typeof reposResponseSchema>;

export const branchSchema = z.object({
  name: branchNameSchema,
  protected: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

/** GET /api/github/installations/:id/branches */
export const branchesResponseSchema = z.object({
  branches: z.array(branchSchema),
  defaultBranch: branchNameSchema,
  page: z.number().int().positive(),
  hasMore: z.boolean(),
});
export type BranchesResponse = z.infer<typeof branchesResponseSchema>;

/** Query of GET /api/github/installations/:id/branches. */
export const branchesQuerySchema = z.object({
  repo: repoFullNameSchema,
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type BranchesQuery = z.infer<typeof branchesQuerySchema>;

/** Query of GET /api/github/installations/:id/repos. */
export const reposQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ReposQuery = z.infer<typeof reposQuerySchema>;

/**
 * Query of GET /api/github/installations/callback when `state` is present
 * (D-20). `installation_id` and `setup_action` are optional; a request
 * without `state` never reaches this schema.
 */
export const installationCallbackQuerySchema = z.object({
  installation_id: z.coerce.number().int().positive().optional(),
  setup_action: z.string().max(32).optional(),
  state: z.string().min(1).max(128),
  code: z.string().min(1).max(256),
});
export type InstallationCallbackQuery = z.infer<typeof installationCallbackQuerySchema>;

// --- GitHub API responses (validated before use) ---------------------------

/** POST /app/installations/:id/access_tokens */
export const ghInstallationTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: isoDateTimeSchema,
});
export type GhInstallationTokenResponse = z.infer<typeof ghInstallationTokenResponseSchema>;

export const ghRepositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: repoFullNameSchema,
  default_branch: z.string().min(1),
  private: z.boolean(),
});
export type GhRepository = z.infer<typeof ghRepositorySchema>;

/** GET /installation/repositories */
export const ghInstallationRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(ghRepositorySchema),
});

/** GET /repos/:owner/:repo */
export const ghRepoDetailSchema = ghRepositorySchema;

/** GET /repos/:owner/:repo/git/trees/:ref?recursive=1 (paths only are kept). */
export const ghTreeEntrySchema = z.object({
  path: z.string().min(1),
  type: z.enum(["blob", "tree", "commit"]),
  size: z.number().int().nonnegative().optional(),
  sha: z.string().min(1),
});
export const ghTreeResponseSchema = z.object({
  sha: z.string().min(1),
  tree: z.array(ghTreeEntrySchema),
  truncated: z.boolean(),
});
export type GhTreeResponse = z.infer<typeof ghTreeResponseSchema>;

/** GET /repos/:owner/:repo/branches (list item; extra fields ignored). */
// R11-6: the name is only required to be a string here; names our rules
// reject are dropped (and counted) by the client, not a whole-page failure.
export const ghBranchListItemSchema = z.object({
  name: z.string().min(1),
  protected: z.boolean(),
});
export const ghBranchListSchema = z.array(ghBranchListItemSchema);

/** GET /repos/:owner/:repo/git/blobs/:sha (base64 content). */
export const ghBlobSchema = z.object({
  sha: z.string().min(1),
  size: z.number().int().nonnegative(),
  encoding: z.string(),
  content: z.string(),
});

/** GET /repos/:owner/:repo/branches/:branch (head sha only). */
export const ghBranchSchema = z.object({
  name: branchNameSchema,
  commit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
});

/** POST https://github.com/login/oauth/access_token (JSON accept). */
export const ghOAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
});

/** GET /user/installations */
export const ghUserInstallationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({ login: z.string().min(1) }),
});
export const ghUserInstallationsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(ghUserInstallationSchema),
});

/** GET /user (D-22): the GitHub account behind the one-time user token. */
export const ghAuthenticatedUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(255),
});
export type GhAuthenticatedUser = z.infer<typeof ghAuthenticatedUserSchema>;

/**
 * GET /user/installations/{installation_id}/repositories (D-22). `full_name`
 * is a plain string here: items failing repoFullNameSchema are dropped and
 * counted by the caller, never stored.
 */
export const ghUserInstallationRepoSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  private: z.boolean(),
  default_branch: z.string().min(1).max(255),
});
export const ghUserInstallationReposSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(ghUserInstallationRepoSchema),
});

// --- Webhook payloads (only the fields used) --------------------------------

/** `installation_repositories` event (D-22). */
export const ghWebhookInstallationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).optional(),
});
export type GhWebhookInstallationRepositoriesEvent = z.infer<
  typeof ghWebhookInstallationRepositoriesEventSchema
>;

export const ghWebhookInstallationEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
});

/** `push` event (contract section 6): only the fields used. */
export const ghWebhookPushEventSchema = z.object({
  ref: z.string(),
  after: z.string(),
  deleted: z.boolean().optional(),
  repository: z.object({ full_name: repoFullNameSchema }),
  installation: z.object({ id: z.number().int().positive() }),
});
export type GhWebhookPushEvent = z.infer<typeof ghWebhookPushEventSchema>;

/** GET /repos/:owner/:repo/installation (App JWT). Only the id is used. */
export const ghRepoInstallationSchema = z.object({
  id: z.number().int().positive(),
});
