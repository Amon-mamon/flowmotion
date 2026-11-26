import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  INSTALLATION_COLUMNS,
  installationRowSchema,
  type InstallationRow,
} from "@/server/db-rows";
import { ApiError } from "@/server/http";

/**
 * github_installations access. Reads use the user's session client (RLS
 * owner-only select); writes use the service role with an explicit user_id.
 */

export async function listInstallationsForUser(userId: string): Promise<InstallationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_installations")
    .select(INSTALLATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error(`installations select failed: ${error.code ?? "unknown"}`);
  return z.array(installationRowSchema).parse(data);
}

export async function getInstallationForUser(
  userId: string,
  id: string,
): Promise<InstallationRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_installations")
    .select(INSTALLATION_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error !== null) throw new Error(`installation select failed: ${error.code ?? "unknown"}`);
  if (data === null) return null;
  return installationRowSchema.parse(data);
}

/** Deletes the user's row; projects get installation_id = null via FK. */
export async function deleteInstallationForUser(userId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("github_installations")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");
  if (error !== null) throw new Error(`installation delete failed: ${error.code ?? "unknown"}`);
  const deleted = z.array(z.object({ id: z.uuid() })).parse(data);
  if (deleted.length === 0) throw new ApiError("NOT_FOUND");
}

/** Webhook `installation.deleted`: removes every row with that GitHub id. */
export async function deleteInstallationsByGitHubId(installationId: number): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("github_installations")
    .delete()
    .eq("installation_id", installationId)
    .select("id");
  if (error !== null) throw new Error(`installation delete failed: ${error.code ?? "unknown"}`);
  return z.array(z.object({ id: z.uuid() })).parse(data).length;
}

/** The callback's GitHub account differs from the one already linked (D-22). */
export class GitHubAccountMismatchError extends Error {
  constructor() {
    super("github_account_mismatch");
    this.name = "GitHubAccountMismatchError";
  }
}

/**
 * The callback's GitHub account is already held by another Flow Motion
 * account (D-44). Nothing was written.
 */
export class GitHubAccountInUseError extends Error {
  constructor() {
    super("github_in_use");
    this.name = "GitHubAccountInUseError";
  }
}

export interface LinkInstallationInput {
  installationId: number;
  accountLogin: string;
  /** Account the installation is on (D-43); only linkable types. */
  accountType: "User" | "Organization";
  accountId: number;
  repos: readonly { id: number; fullName: string; private: boolean; defaultBranch: string }[];
}

const linkResultSchema = z.array(
  z.object({ installation_id: z.number().int().positive(), inserted: z.boolean() }),
);

/**
 * Calls the service-role-only `link_github_installations()` (contract
 * section 5, Phase 1.2): one transaction that upserts the listed
 * installations, replaces each repo set, deletes the user's unlisted rows
 * linked before Phase 1.2 and clears the other unlisted rows, and writes
 * nothing on a GitHub account mismatch (D-22), a GitHub account held by
 * another Flow Motion user (D-44), or a non-linkable item (D-43). Returns the GitHub ids of
 * rows that were newly inserted.
 */
export async function linkGithubInstallations(input: {
  userId: string;
  githubUserId: number;
  githubUserLogin: string;
  installations: readonly LinkInstallationInput[];
}): Promise<number[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("link_github_installations", {
    p_user_id: input.userId,
    p_github_user_id: input.githubUserId,
    p_github_user_login: input.githubUserLogin,
    p_installations: input.installations.map((item) => ({
      installationId: item.installationId,
      accountLogin: item.accountLogin,
      accountType: item.accountType,
      accountId: item.accountId,
      repos: item.repos.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
      })),
    })),
  });
  if (error !== null) {
    const message = typeof error.message === "string" ? error.message : "";
    if (message.includes("github_account_mismatch")) throw new GitHubAccountMismatchError();
    if (message.includes("github_in_use")) throw new GitHubAccountInUseError();
    // Fail-closed backstop of the linking rule (D-43): a plain failure,
    // logged by code only.
    if (message.includes("installation_not_allowed")) {
      throw new Error("link_github_installations failed: installation_not_allowed");
    }
    throw new Error(`link_github_installations failed: ${error.code ?? "unknown"}`);
  }
  return linkResultSchema
    .parse(data ?? [])
    .filter((row) => row.inserted)
    .map((row) => row.installation_id);
}

/**
 * Webhook `installation_repositories` `removed` (D-22): deletes those repo
 * ids from every user's access set for that GitHub installation.
 */
export async function revokeInstallationRepos(
  githubInstallationId: number,
  repoIds: readonly number[],
): Promise<number> {
  if (repoIds.length === 0) return 0;
  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from("github_installations")
    .select("id")
    .eq("installation_id", githubInstallationId);
  if (error !== null) throw new Error(`installations select failed: ${error.code ?? "unknown"}`);
  const rowIds = z.array(z.object({ id: z.uuid() })).parse(rows).map((row) => row.id);
  if (rowIds.length === 0) return 0;
  const { data, error: deleteError } = await supabase
    .from("github_installation_repos")
    .delete()
    .in("installation_id", rowIds)
    .in("repo_id", [...repoIds])
    .select("repo_id");
  if (deleteError !== null) {
    throw new Error(`installation repos delete failed: ${deleteError.code ?? "unknown"}`);
  }
  return z.array(z.object({ repo_id: z.number() })).parse(data).length;
}
