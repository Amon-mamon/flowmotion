import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "@/schemas/api";

/** "owner/name" as GitHub formats it. */
export const repoFullNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/name");

// --- DTOs (docs/contract.md section 6) -------------------------------------

export const installationSchema = z.object({
  /** github_installations.id (uuid). */
  id: uuidSchema,
  /** GitHub's numeric installation id. */
  installationId: z.number().int().positive(),
  accountLogin: z.string(),
  createdAt: isoDateTimeSchema,
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

/** Query of GET /api/github/installations/:id/repos. */
export const reposQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ReposQuery = z.infer<typeof reposQuerySchema>;

/** Query of GET /api/github/installations/callback. */
export const installationCallbackQuerySchema = z.object({
  installation_id: z.coerce.number().int().positive(),
  setup_action: z.string().optional(),
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
  id: z.number().int(),
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

/** GET /repos/:owner/:repo/branches/:branch (head sha only). */
export const ghBranchSchema = z.object({
  name: z.string().min(1),
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

// --- Webhook payloads (only the fields used) --------------------------------

export const ghWebhookInstallationEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive() }),
});

export const ghWebhookPushEventSchema = z.object({
  ref: z.string(),
  after: z.string(),
  repository: z.object({
    full_name: repoFullNameSchema,
    default_branch: z.string().min(1),
  }),
  installation: z.object({ id: z.number().int().positive() }).optional(),
});

/** GET /repos/:owner/:repo/installation (App JWT). Only the id is used. */
export const ghRepoInstallationSchema = z.object({
  id: z.number().int().positive(),
});
