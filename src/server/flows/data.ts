import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toIso, type NewestFlow } from "@/server/db-rows";
import { ApiError } from "@/server/http";
import { jobErrorCodeSchema } from "@/schemas/api";
import { flowStatusSchema, type FlowSummary } from "@/schemas/flow";

/**
 * Flow data access (contract sections 5 and 6, Phase 3b). Reads use the
 * user's session (RLS owner-only select) and always filter by user id as
 * well; inserts and the cleanup of a lost race use the service role.
 * `jobs.state` is never read here. Errors carry table names and codes only.
 */

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

export const FLOW_EXISTS_MESSAGE = "A flow already exists for this recommendation.";
export const ONE_ANALYSIS_MESSAGE = "Choose recommendations from one analysis.";
export const RECONNECT_TO_GENERATE = "Reconnect GitHub to generate flows";
export const FLOWS_LIST_LIMIT = 20;

const timestamp = z.string();

export const FLOW_SUMMARY_COLUMNS = "id, user_id, recommendation_id, name, status, error_code, created_at";
export const FLOW_DETAIL_COLUMNS = `${FLOW_SUMMARY_COLUMNS}, flow_spec, n8n_json, setup_checklist, catalog_version, n8n_version`;

export const flowSummaryRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  recommendation_id: z.uuid(),
  name: z.string(),
  status: flowStatusSchema,
  error_code: z.string().nullable(),
  created_at: timestamp,
});
export type FlowSummaryRow = z.infer<typeof flowSummaryRowSchema>;

export const flowDetailRowSchema = flowSummaryRowSchema.extend({
  flow_spec: z.unknown().nullable(),
  n8n_json: z.unknown().nullable(),
  setup_checklist: z.unknown().nullable(),
  catalog_version: z.string().nullable(),
  n8n_version: z.string().nullable(),
});
export type FlowDetailRow = z.infer<typeof flowDetailRowSchema>;

/** The ids and repo name a flow DTO carries besides the flow row. */
export interface FlowLinks {
  analysisId: string;
  projectId: string;
  repoFullName: string;
}

function failed(what: string, error: { code?: string } | null): never {
  throw new Error(`${what} failed: ${error?.code ?? "unknown"}`);
}

export function parseJobErrorCode(value: string | null) {
  const parsed = jobErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getFlowForUser(userId: string, flowId: string): Promise<FlowDetailRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select(FLOW_DETAIL_COLUMNS)
    .eq("user_id", userId)
    .eq("id", flowId)
    .maybeSingle();
  if (error !== null) failed("flow select", error);
  return data === null ? null : flowDetailRowSchema.parse(data);
}

/**
 * Links for several flows in a constant number of queries (recommendations,
 * analyses, projects; never one per flow). Flows whose chain is missing are
 * absent from the map.
 */
export async function linksForFlows(
  userId: string,
  rows: readonly { id: string; recommendation_id: string }[],
): Promise<Map<string, FlowLinks>> {
  const out = new Map<string, FlowLinks>();
  if (rows.length === 0) return out;
  const supabase = await createClient();
  const recIds = [...new Set(rows.map((row) => row.recommendation_id))];
  const recs = await supabase.from("recommendations").select("id, analysis_id").eq("user_id", userId).in("id", recIds);
  if (recs.error !== null) failed("recommendations select", recs.error);
  const recRows = z.array(z.object({ id: z.uuid(), analysis_id: z.uuid() })).parse(recs.data ?? []);
  const analysisIds = [...new Set(recRows.map((row) => row.analysis_id))];
  if (analysisIds.length === 0) return out;
  const analyses = await supabase
    .from("analyses")
    .select("id, project_id")
    .eq("user_id", userId)
    .in("id", analysisIds);
  if (analyses.error !== null) failed("analyses select", analyses.error);
  const analysisRows = z.array(z.object({ id: z.uuid(), project_id: z.uuid() })).parse(analyses.data ?? []);
  const projectIds = [...new Set(analysisRows.map((row) => row.project_id))];
  if (projectIds.length === 0) return out;
  const projects = await supabase
    .from("projects")
    .select("id, repo_full_name")
    .eq("user_id", userId)
    .in("id", projectIds);
  if (projects.error !== null) failed("projects select", projects.error);
  const projectRows = z.array(z.object({ id: z.uuid(), repo_full_name: z.string() })).parse(projects.data ?? []);

  const analysisOf = new Map(recRows.map((row) => [row.id, row.analysis_id]));
  const projectOf = new Map(analysisRows.map((row) => [row.id, row.project_id]));
  const repoOf = new Map(projectRows.map((row) => [row.id, row.repo_full_name]));
  for (const row of rows) {
    const analysisId = analysisOf.get(row.recommendation_id);
    const projectId = analysisId === undefined ? undefined : projectOf.get(analysisId);
    const repoFullName = projectId === undefined ? undefined : repoOf.get(projectId);
    if (analysisId !== undefined && projectId !== undefined && repoFullName !== undefined) {
      out.set(row.id, { analysisId, projectId, repoFullName });
    }
  }
  return out;
}

/** GET /api/flows: the user's flows, newest first, at most 20. */
export async function listFlowSummaries(userId: string): Promise<FlowSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select(FLOW_SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(FLOWS_LIST_LIMIT);
  if (error !== null) failed("flows select", error);
  const rows = z.array(flowSummaryRowSchema).parse(data ?? []);
  const links = await linksForFlows(userId, rows);
  const out: FlowSummary[] = [];
  for (const row of rows) {
    const link = links.get(row.id);
    if (link === undefined) continue;
    out.push({
      id: row.id,
      recommendationId: row.recommendation_id,
      analysisId: link.analysisId,
      projectId: link.projectId,
      repoFullName: link.repoFullName,
      name: row.name,
      status: row.status,
      errorCode: parseJobErrorCode(row.error_code),
      createdAt: toIso(row.created_at),
    });
  }
  return out;
}

/**
 * The newest flow per recommendation for a whole list in ONE query (D-41),
 * never one per row. Returns recommendation id → newest flow.
 */
export async function newestFlowsByRecommendation(
  userId: string,
  recommendationIds: readonly string[],
): Promise<Map<string, NewestFlow>> {
  const out = new Map<string, NewestFlow>();
  if (recommendationIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select("id, recommendation_id, status, created_at")
    .eq("user_id", userId)
    .in("recommendation_id", [...recommendationIds])
    .order("created_at", { ascending: false });
  if (error !== null) failed("flows select", error);
  const rows = z
    .array(z.object({ id: z.uuid(), recommendation_id: z.uuid(), status: flowStatusSchema, created_at: timestamp }))
    .parse(data ?? []);
  const newestAt = new Map<string, number>();
  for (const row of rows) {
    // Rows arrive newest first; the explicit compare keeps it right regardless of order.
    const at = Date.parse(row.created_at);
    const current = newestAt.get(row.recommendation_id);
    if (current === undefined || at > current) {
      newestAt.set(row.recommendation_id, at);
      out.set(row.recommendation_id, { id: row.id, status: row.status });
    }
  }
  return out;
}

// --- POST /api/recommendations/generate -----------------------------------------

export const generateRecommendationRowSchema = z.object({
  id: z.uuid(),
  analysis_id: z.uuid(),
  title: z.string(),
});
export type GenerateRecommendationRow = z.infer<typeof generateRecommendationRowSchema>;

export async function getRecommendationsForUser(
  userId: string,
  ids: readonly string[],
): Promise<GenerateRecommendationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendations")
    .select("id, analysis_id, title")
    .eq("user_id", userId)
    .in("id", [...ids]);
  if (error !== null) failed("recommendations select", error);
  return z.array(generateRecommendationRowSchema).parse(data ?? []);
}

export const generateAnalysisRowSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  commit_sha: z.string().nullable(),
});

export async function getAnalysisRefForUser(userId: string, analysisId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, project_id, commit_sha")
    .eq("user_id", userId)
    .eq("id", analysisId)
    .maybeSingle();
  if (error !== null) failed("analysis select", error);
  return data === null ? null : generateAnalysisRowSchema.parse(data);
}

/** True when any of the recommendations has a `generating` or `ready` flow. */
export async function hasActiveFlow(userId: string, recommendationIds: readonly string[]): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flows")
    .select("id")
    .eq("user_id", userId)
    .in("recommendation_id", [...recommendationIds])
    .in("status", ["generating", "ready"])
    .limit(1);
  if (error !== null) failed("flows select", error);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Inserts one `generating` flow per recommendation (name = its title) in one
 * statement, then one `generate` job each (step `context`, ref_id = flow id).
 * A racing insert that hits `flows_active_recommendation_key` inserts nothing
 * (one statement) and becomes the "already exists" error; a failed job insert
 * deletes the rows this request inserted. Returns flow ids in input order.
 */
export async function createFlowsWithJobs(input: {
  userId: string;
  recommendations: readonly { id: string; title: string }[];
}): Promise<string[]> {
  const supabase = createAdminClient();
  const flowIds = input.recommendations.map(() => crypto.randomUUID());
  const inserted = await supabase.from("flows").insert(
    input.recommendations.map((rec, index) => ({
      id: flowIds[index],
      user_id: input.userId,
      recommendation_id: rec.id,
      name: rec.title.slice(0, 120),
      status: "generating",
    })),
  );
  if (inserted.error !== null) {
    if (inserted.error.code === UNIQUE_VIOLATION) {
      await deleteFlows(input.userId, flowIds);
      throw new ApiError("VALIDATION_ERROR", FLOW_EXISTS_MESSAGE);
    }
    failed("flows insert", inserted.error);
  }
  const jobs = await supabase.from("jobs").insert(
    flowIds.map((flowId) => ({
      user_id: input.userId,
      kind: "generate",
      ref_id: flowId,
      status: "queued",
      step: "context",
    })),
  );
  if (jobs.error !== null) {
    await supabase.from("jobs").delete().eq("kind", "generate").in("ref_id", flowIds);
    await deleteFlows(input.userId, flowIds);
    failed("jobs insert", jobs.error);
  }
  return flowIds;
}

async function deleteFlows(userId: string, flowIds: readonly string[]): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("flows").delete().eq("user_id", userId).in("id", [...flowIds]);
  if (error !== null) failed("flows delete", error);
}
