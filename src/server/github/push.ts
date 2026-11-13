import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { GhWebhookPushEvent } from "@/schemas/github";

/**
 * Webhook `push` → stale (contract section 6, Phase 1.1 item 7). A push
 * matches a project only on its chosen branch (`refs/heads/<projects.branch>`,
 * exact and case-sensitive), never the default branch. No AI is spent.
 */

export interface PushCandidate {
  id: string;
  repo_full_name: string;
  branch: string;
  status: "pending" | "valid" | "invalid";
}

export interface PushUpdate {
  id: string;
  last_commit_sha: string;
  stale?: true;
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * Pure decision: which of the installation's projects this push updates.
 * `candidates` are the projects whose installation row has GitHub id
 * `installation.id`.
 */
export function planPushUpdates(
  event: GhWebhookPushEvent,
  candidates: readonly PushCandidate[],
): PushUpdate[] {
  if (event.deleted === true) return [];
  if (!SHA.test(event.after)) return [];
  const repo = event.repository.full_name.toLowerCase();
  return candidates
    .filter((project) => project.repo_full_name.toLowerCase() === repo)
    .filter((project) => event.ref === `refs/heads/${project.branch}`)
    .map((project) => ({
      id: project.id,
      last_commit_sha: event.after,
      ...(project.status !== "pending" ? { stale: true as const } : {}),
    }));
}

const candidateSchema = z.object({
  id: z.uuid(),
  repo_full_name: z.string(),
  branch: z.string(),
  status: z.enum(["pending", "valid", "invalid"]),
});

/** Projects linked through any github_installations row with this GitHub id. */
export async function listPushCandidates(githubInstallationId: number): Promise<PushCandidate[]> {
  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from("github_installations")
    .select("id")
    .eq("installation_id", githubInstallationId);
  if (error !== null) throw new Error(`installations select failed: ${error.code ?? "unknown"}`);
  const ids = z.array(z.object({ id: z.uuid() })).parse(rows).map((row) => row.id);
  if (ids.length === 0) return [];
  const { data, error: projectsError } = await supabase
    .from("projects")
    .select("id, repo_full_name, branch, status")
    .in("installation_id", ids);
  if (projectsError !== null) throw new Error(`projects select failed: ${projectsError.code ?? "unknown"}`);
  return z.array(candidateSchema).parse(data);
}

export async function applyPushUpdates(updates: readonly PushUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const supabase = createAdminClient();
  for (const update of updates) {
    const { error } = await supabase
      .from("projects")
      .update({ last_commit_sha: update.last_commit_sha, ...(update.stale ? { stale: true } : {}) })
      .eq("id", update.id);
    if (error !== null) throw new Error(`project update failed: ${error.code ?? "unknown"}`);
  }
}

/** Full handler; returns how many projects were updated. */
export async function handlePushEvent(event: GhWebhookPushEvent): Promise<number> {
  if (event.deleted === true || !SHA.test(event.after)) return 0;
  const candidates = await listPushCandidates(event.installation.id);
  const updates = planPushUpdates(event, candidates);
  await applyPushUpdates(updates);
  return updates.length;
}
