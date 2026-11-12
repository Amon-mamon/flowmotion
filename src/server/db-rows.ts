import { z } from "zod";

import type { Installation } from "@/schemas/github";
import type { Profile } from "@/schemas/profile";
import type { Project, ProjectAnalysisSummary } from "@/schemas/project";

/**
 * Database row schemas (snake_case) and mappers to the camelCase DTOs in
 * docs/contract.md section 6. Rows are validated when they leave Supabase so
 * the API never emits an unexpected shape.
 */

const timestamp = z.string();

export const installationRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  installation_id: z.number().int(),
  account_login: z.string(),
  created_at: timestamp,
});
export type InstallationRow = z.infer<typeof installationRowSchema>;

export const projectRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  installation_id: z.uuid().nullable(),
  repo_full_name: z.string(),
  default_branch: z.string(),
  status: z.enum(["pending", "valid", "invalid"]),
  invalid_reason: z.string().nullable(),
  detected_kind: z.enum(["website", "app"]).nullable(),
  last_commit_sha: z.string().nullable(),
  stale: z.boolean(),
  created_at: timestamp,
});
export type ProjectRow = z.infer<typeof projectRowSchema>;

export const analysisSummaryRowSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "validating", "scanning", "analyzing", "done", "failed", "rejected"]),
  commit_sha: z.string().nullable(),
  started_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
});

export const profileRowSchema = z.object({
  id: z.uuid(),
  display_name: z.string().nullable(),
});

export const PROJECT_COLUMNS =
  "id, user_id, installation_id, repo_full_name, default_branch, status, invalid_reason, detected_kind, last_commit_sha, stale, created_at";
export const INSTALLATION_COLUMNS = "id, user_id, installation_id, account_login, created_at";
export const ANALYSIS_SUMMARY_COLUMNS = "id, status, commit_sha, started_at, finished_at";

/** Postgres returns `+00:00`-style offsets; normalise to ISO 8601 `Z`. */
export function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function toInstallationDto(row: InstallationRow): Installation {
  return {
    id: row.id,
    installationId: row.installation_id,
    accountLogin: row.account_login,
    createdAt: toIso(row.created_at),
  };
}

export function toProjectDto(row: ProjectRow): Project {
  return {
    id: row.id,
    repoFullName: row.repo_full_name,
    defaultBranch: row.default_branch,
    status: row.status,
    invalidReason: row.invalid_reason,
    detectedKind: row.detected_kind,
    lastCommitSha: row.last_commit_sha,
    stale: row.stale,
    installationId: row.installation_id,
    createdAt: toIso(row.created_at),
  };
}

export function toAnalysisSummaryDto(
  row: z.infer<typeof analysisSummaryRowSchema>,
): ProjectAnalysisSummary {
  return {
    id: row.id,
    status: row.status,
    commitSha: row.commit_sha,
    startedAt: row.started_at === null ? null : toIso(row.started_at),
    finishedAt: row.finished_at === null ? null : toIso(row.finished_at),
  };
}

export function toProfileDto(row: z.infer<typeof profileRowSchema>, email: string): Profile {
  return { id: row.id, email, displayName: row.display_name };
}
