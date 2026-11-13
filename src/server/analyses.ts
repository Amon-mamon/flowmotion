import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ANALYSIS_COLUMNS,
  FINDING_COLUMNS,
  RECOMMENDATION_COLUMNS,
  analysisRowSchema,
  findingRowSchema,
  recommendationRowSchema,
  type AnalysisRow,
  type FindingRow,
  type RecommendationRow,
} from "@/server/db-rows";
import { ApiError } from "@/server/http";
import { ACTIVE_ANALYSIS_STATUSES } from "@/schemas/analysis";

/**
 * Analysis data access (contract sections 5 and 6, Phase 2). Reads use the
 * user's session (RLS owner-only select) and always filter by user id as
 * well; pipeline writes use the service role. `jobs.state` is never read
 * here.
 */

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

export const ANALYSIS_ALREADY_RUNNING = "An analysis is already running";
export const RECONNECT_TO_ANALYZE = "Reconnect GitHub to analyze this project";

export async function getAnalysisForUser(userId: string, analysisId: string): Promise<AnalysisRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select(ANALYSIS_COLUMNS)
    .eq("user_id", userId)
    .eq("id", analysisId)
    .maybeSingle();
  if (error !== null) throw new Error(`analysis select failed: ${error.code ?? "unknown"}`);
  return data === null ? null : analysisRowSchema.parse(data);
}

export async function hasActiveAnalysis(userId: string, projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .in("status", [...ACTIVE_ANALYSIS_STATUSES])
    .limit(1);
  if (error !== null) throw new Error(`analyses select failed: ${error.code ?? "unknown"}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Resolves which analysis of a project the findings / recommendations
 * routes read: the given one (must belong to this project and user, else
 * NOT_FOUND), or the latest `done` analysis (null when there is none).
 */
export async function resolveAnalysisId(
  userId: string,
  projectId: string,
  analysisId: string | undefined,
): Promise<string | null> {
  const supabase = await createClient();
  if (analysisId !== undefined) {
    const { data, error } = await supabase
      .from("analyses")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("id", analysisId)
      .maybeSingle();
    if (error !== null) throw new Error(`analysis select failed: ${error.code ?? "unknown"}`);
    if (data === null) throw new ApiError("NOT_FOUND");
    return analysisId;
  }
  const { data, error } = await supabase
    .from("analyses")
    .select("id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("status", "done")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error !== null) throw new Error(`analyses select failed: ${error.code ?? "unknown"}`);
  const rows = z.array(z.object({ id: z.uuid() })).parse(data ?? []);
  return rows[0]?.id ?? null;
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;

/** Findings sorted severity high → low, then filePath, then line. */
export function sortFindings(rows: readonly FindingRow[]): FindingRow[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

/** Recommendations sorted confidence desc, then title. */
export function sortRecommendations(rows: readonly RecommendationRow[]): RecommendationRow[] {
  return [...rows].sort(
    (a, b) => b.confidence - a.confidence || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );
}

export async function listFindings(userId: string, analysisId: string): Promise<FindingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("security_findings")
    .select(FINDING_COLUMNS)
    .eq("user_id", userId)
    .eq("analysis_id", analysisId)
    .limit(500);
  if (error !== null) throw new Error(`findings select failed: ${error.code ?? "unknown"}`);
  return sortFindings(z.array(findingRowSchema).parse(data ?? []));
}

export async function listRecommendations(userId: string, analysisId: string): Promise<RecommendationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendations")
    .select(RECOMMENDATION_COLUMNS)
    .eq("user_id", userId)
    .eq("analysis_id", analysisId)
    .limit(100);
  if (error !== null) throw new Error(`recommendations select failed: ${error.code ?? "unknown"}`);
  return sortRecommendations(z.array(recommendationRowSchema).parse(data ?? []));
}

/** Stores the GitHub repo id on a project that predates D-22 (service role). */
export async function setProjectRepoId(userId: string, projectId: string, repoId: number): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("projects")
    .update({ repo_id: repoId })
    .eq("id", projectId)
    .eq("user_id", userId)
    .is("repo_id", null);
  if (error !== null) throw new Error(`project repo_id update failed: ${error.code ?? "unknown"}`);
}

/**
 * Inserts the analysis (queued, progress 0, branch copied from the project)
 * and its job (`analyze`, step `validate`). A racing second insert hits the
 * partial unique index and becomes "An analysis is already running".
 */
export async function createAnalysisWithJob(input: {
  userId: string;
  projectId: string;
  branch: string;
  nowIso: string;
}): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("analyses")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      status: "queued",
      progress: 0,
      branch: input.branch,
      started_at: input.nowIso,
    })
    .select("id")
    .single();
  if (error !== null) {
    if (error.code === UNIQUE_VIOLATION) throw new ApiError("VALIDATION_ERROR", ANALYSIS_ALREADY_RUNNING);
    throw new Error(`analysis insert failed: ${error.code ?? "unknown"}`);
  }
  const analysisId = z.object({ id: z.uuid() }).parse(data).id;

  const job = await supabase.from("jobs").insert({
    user_id: input.userId,
    kind: "analyze",
    ref_id: analysisId,
    status: "queued",
    step: "validate",
    // run_after defaults to the database's now().
  });
  if (job.error !== null) {
    // Without a job the analysis would never move: end it instead of leaving it active.
    await supabase
      .from("analyses")
      .update({ status: "failed", error_code: "INTERNAL", finished_at: input.nowIso })
      .eq("id", analysisId);
    throw new Error(`job insert failed: ${job.error.code ?? "unknown"}`);
  }
  return analysisId;
}
