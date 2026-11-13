import "server-only";

import { z } from "zod";

import { getInstallationRepo, type RepoWithId } from "@/lib/github/client";
import { createClient } from "@/lib/supabase/server";
import { needsRepoRefresh } from "@/server/db-rows";
import { mintInstallationToken, repoInstallationId } from "@/server/github/app";
import { ApiError } from "@/server/http";
import type { Repo } from "@/schemas/github";

export const REPO_NOT_COVERED_MESSAGE =
  "This repository is not available through the selected GitHub installation.";

export const BRANCH_NOT_FOUND_MESSAGE = "That branch was not found.";

export const REFRESH_REQUIRED_MESSAGE = "Refresh repository access to continue.";

export function refreshRequired(): ApiError {
  return new ApiError("GITHUB_REFRESH_REQUIRED", REFRESH_REQUIRED_MESSAGE);
}

// --- per-user repo access set (D-22) -------------------------------------------

export const accessRowSchema = z.object({
  repo_id: z.number().int().positive(),
  repo_full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string(),
});
export type AccessRow = z.infer<typeof accessRowSchema>;

export interface RepoAccessQuery {
  /** Matched first when known (projects.repo_id). */
  repoId?: number | null;
  fullName: string;
}

/**
 * Pure decision (contract section 6 "Repository access"): the set must be
 * fresh (synced within 24 h) and contain the repo, by id when known, else by
 * case-insensitive full name. Any failure is GITHUB_REFRESH_REQUIRED.
 */
export function evaluateRepoAccess(
  reposSyncedAt: string | null,
  rows: readonly AccessRow[],
  query: RepoAccessQuery,
  nowMs: number = Date.now(),
): AccessRow {
  if (needsRepoRefresh(reposSyncedAt, nowMs)) throw refreshRequired();
  const match =
    query.repoId !== undefined && query.repoId !== null
      ? rows.find((row) => row.repo_id === query.repoId)
      : rows.find((row) => row.repo_full_name.toLowerCase() === query.fullName.toLowerCase());
  if (match === undefined) throw refreshRequired();
  return match;
}

const syncRowSchema = z.object({ repos_synced_at: z.string().nullable() });

async function readSyncedAt(userId: string, installationRowId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_installations")
    .select("repos_synced_at")
    .eq("user_id", userId)
    .eq("id", installationRowId)
    .maybeSingle();
  if (error !== null) throw new Error(`installation select failed: ${error.code ?? "unknown"}`);
  if (data === null) throw new ApiError("NOT_FOUND");
  return syncRowSchema.parse(data).repos_synced_at;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Throws GITHUB_REFRESH_REQUIRED unless the repo is in the user's fresh
 * access set for this installation row. Runs before any GitHub call for the
 * repo, so it reveals nothing about repos outside the set.
 */
export async function requireRepoAccess(
  userId: string,
  installationRowId: string,
  query: RepoAccessQuery,
): Promise<AccessRow> {
  const syncedAt = await readSyncedAt(userId, installationRowId);
  if (needsRepoRefresh(syncedAt)) throw refreshRequired();
  const supabase = await createClient();
  let request = supabase
    .from("github_installation_repos")
    .select("repo_id, repo_full_name, private, default_branch")
    .eq("user_id", userId)
    .eq("installation_id", installationRowId);
  request =
    query.repoId !== undefined && query.repoId !== null
      ? request.eq("repo_id", query.repoId)
      : request.ilike("repo_full_name", escapeLike(query.fullName));
  const { data, error } = await request.limit(5);
  if (error !== null) throw new Error(`installation repos select failed: ${error.code ?? "unknown"}`);
  return evaluateRepoAccess(syncedAt, z.array(accessRowSchema).parse(data), query);
}

export const REPOS_PAGE_SIZE = 100;

/**
 * GET .../repos (D-22): the user's own access set, no GitHub call. Ordered by
 * lower(repo_full_name), 100 per page. A set holds at most 1000 repos per
 * installation (10 GitHub pages), so it is sorted in memory.
 */
export async function listAccessibleRepos(
  userId: string,
  installationRowId: string,
  reposSyncedAt: string | null,
  page: number,
): Promise<{ repos: Repo[]; page: number; hasMore: boolean }> {
  if (needsRepoRefresh(reposSyncedAt)) throw refreshRequired();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_installation_repos")
    .select("repo_id, repo_full_name, private, default_branch")
    .eq("user_id", userId)
    .eq("installation_id", installationRowId)
    .limit(2000);
  if (error !== null) throw new Error(`installation repos select failed: ${error.code ?? "unknown"}`);
  const rows = z
    .array(accessRowSchema)
    .parse(data)
    .sort((a, b) => {
      const x = a.repo_full_name.toLowerCase();
      const y = b.repo_full_name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const start = (page - 1) * REPOS_PAGE_SIZE;
  return {
    repos: rows.slice(start, start + REPOS_PAGE_SIZE).map((row) => ({
      fullName: row.repo_full_name,
      defaultBranch: row.default_branch,
      private: row.private,
    })),
    page,
    hasMore: rows.length > start + REPOS_PAGE_SIZE,
  };
}

// --- installation coverage (Phase 1, R1-14) --------------------------------------

export interface CoveredRepo {
  /** Short-lived installation token. Never logged or returned. */
  token: string;
  repo: RepoWithId;
}

/**
 * Reads `fullName` with the installation's token (`GET /repos/{o}/{r}`) and
 * requires `GET /repos/{o}/{r}/installation` (App JWT) to name this same
 * installation, because an installation token can read any public repo.
 * When `expectedRepoId` is given (the access row's id, D-22), GitHub's repo
 * id must equal it, else GITHUB_REFRESH_REQUIRED (e.g. a repo renamed or
 * recreated under the same name). Returns null when not covered.
 */
export async function resolveCoveredRepo(
  githubInstallationId: number,
  fullName: string,
  expectedRepoId?: number,
): Promise<CoveredRepo | null> {
  const { token } = await mintInstallationToken(githubInstallationId);
  const repo = await getInstallationRepo({ token }, fullName);
  if (repo === null) return null;
  if (expectedRepoId !== undefined && repo.id !== expectedRepoId) throw refreshRequired();
  if ((await repoInstallationId(repo.fullName)) !== githubInstallationId) return null;
  return { token, repo };
}
