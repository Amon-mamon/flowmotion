import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ANALYSIS_SUMMARY_COLUMNS,
  PROJECT_COLUMNS,
  analysisSummaryRowSchema,
  projectRowSchema,
  type ProjectRow,
} from "@/server/db-rows";
import { ApiError } from "@/server/http";

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

export async function listProjectsForUser(userId: string): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error(`projects select failed: ${error.code ?? "unknown"}`);
  return z.array(projectRowSchema).parse(data);
}

export async function getProjectForUser(userId: string, id: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error !== null) throw new Error(`project select failed: ${error.code ?? "unknown"}`);
  if (data === null) return null;
  return projectRowSchema.parse(data);
}

export async function listAnalysisSummaries(userId: string, projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select(ANALYSIS_SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("started_at", { ascending: false, nullsFirst: true });
  if (error !== null) throw new Error(`analyses select failed: ${error.code ?? "unknown"}`);
  return z.array(analysisSummaryRowSchema).parse(data);
}

export async function createProject(input: {
  userId: string;
  installationRowId: string;
  repoFullName: string;
  defaultBranch: string;
}): Promise<ProjectRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: input.userId,
      installation_id: input.installationRowId,
      repo_full_name: input.repoFullName,
      default_branch: input.defaultBranch,
    })
    .select(PROJECT_COLUMNS)
    .single();
  if (error !== null) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new ApiError("VALIDATION_ERROR", "This repository is already connected");
    }
    throw new Error(`project insert failed: ${error.code ?? "unknown"}`);
  }
  return projectRowSchema.parse(data);
}

/**
 * Deletes a project atomically through the `delete_project` Postgres function
 * (one transaction): its jobs rows are removed (jobs.ref_id has no FK) and the
 * FK cascade removes analyses, findings, recommendations, flows and test runs.
 * Throws NOT_FOUND when the project does not belong to the user.
 */
export async function deleteProjectForUser(userId: string, projectId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("delete_project", {
    p_user_id: userId,
    p_project_id: projectId,
  });
  if (error !== null) throw new Error(`delete_project failed: ${error.code ?? "unknown"}`);
  if (z.boolean().parse(data) !== true) throw new ApiError("NOT_FOUND");
}
