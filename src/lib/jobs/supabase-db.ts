import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  jobRowSchema,
  type AnalysisContextRef,
  type AnalysisPatch,
  type FlowPatch,
  type FlowRef,
  type RecommendationRef,
  type AnalysisRef,
  type JobPatch,
  type JobRow,
  type ProjectPatch,
  type ProjectRef,
  type RecommendationInsert,
  type UsageEventInsert,
  type WorkerDb,
} from "@/lib/jobs/types";
import type { MaskedFinding } from "@/lib/security/secret-scanner";
import { analysisStatusSchema } from "@/schemas/analysis";
import { flowStatusSchema } from "@/schemas/flow";

/**
 * WorkerDb over a service-role Supabase client. Runtime-neutral (used by the
 * Deno worker and the local dev runner). Errors carry table names and
 * Postgres codes only, never row contents.
 */

const analysisRefSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  user_id: z.uuid(),
  status: analysisStatusSchema,
  progress: z.number().int(),
  branch: z.string().min(1),
});

const projectRefSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  repo_full_name: z.string().min(1),
  repo_id: z.number().int().positive().nullable(),
  installation_id: z.uuid().nullable(),
});

const flowRefSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  recommendation_id: z.uuid(),
  status: flowStatusSchema,
});

const recommendationRefSchema = z.object({
  id: z.uuid(),
  analysis_id: z.uuid(),
  user_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  trigger_kind: z.enum(["webhook", "schedule", "manual"]),
  node_types: z.array(z.string()),
  required_credentials: z.array(z.string()),
  rationale: z.string(),
  source_files: z.array(z.string()),
});

const analysisContextSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  user_id: z.uuid(),
  commit_sha: z.string().nullable(),
  signals: z.array(z.unknown()).catch([]),
});

function fail(what: string, error: { code?: string } | null): never {
  throw new Error(`${what} failed: ${error?.code ?? "unknown"}`);
}

export function createSupabaseWorkerDb(client: SupabaseClient): WorkerDb {
  return {
    async claimJob(workerId: string, userId?: string): Promise<JobRow | null> {
      const { data, error } = await client.rpc("claim_job", {
        p_worker_id: workerId,
        p_user_id: userId ?? null,
      });
      if (error !== null) fail("claim_job", error);
      const rows = z.array(z.unknown()).parse(data ?? []);
      if (rows.length === 0 || rows[0] === null) return null;
      return jobRowSchema.parse(rows[0]);
    },

    async updateJob(jobId: string, workerId: string, patch: JobPatch): Promise<boolean> {
      const { data, error } = await client
        .from("jobs")
        .update(patch)
        .eq("id", jobId)
        .eq("locked_by", workerId)
        .eq("status", "running")
        .select("id");
      if (error !== null) fail("jobs update", error);
      return Array.isArray(data) && data.length === 1;
    },

    async getAnalysis(id: string): Promise<AnalysisRef | null> {
      const { data, error } = await client
        .from("analyses")
        .select("id, project_id, user_id, status, progress, branch")
        .eq("id", id)
        .maybeSingle();
      if (error !== null) fail("analyses select", error);
      return data === null ? null : analysisRefSchema.parse(data);
    },

    async updateAnalysis(id: string, patch: AnalysisPatch): Promise<void> {
      const { error } = await client.from("analyses").update(patch).eq("id", id);
      if (error !== null) fail("analyses update", error);
    },

    async getProject(id: string): Promise<ProjectRef | null> {
      const { data, error } = await client
        .from("projects")
        .select("id, user_id, repo_full_name, repo_id, installation_id")
        .eq("id", id)
        .maybeSingle();
      if (error !== null) fail("projects select", error);
      return data === null ? null : projectRefSchema.parse(data);
    },

    async updateProject(id: string, patch: ProjectPatch): Promise<void> {
      const { error } = await client.from("projects").update(patch).eq("id", id);
      if (error !== null) fail("projects update", error);
    },

    async getInstallationGithubId(installationRowId: string, userId: string): Promise<number | null> {
      const { data, error } = await client
        .from("github_installations")
        .select("installation_id")
        .eq("id", installationRowId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error !== null) fail("github_installations select", error);
      if (data === null) return null;
      return z.object({ installation_id: z.number().int().positive() }).parse(data).installation_id;
    },

    async replaceFindings(analysisId: string, userId: string, findings: readonly MaskedFinding[]) {
      const removed = await client.from("security_findings").delete().eq("analysis_id", analysisId);
      if (removed.error !== null) fail("security_findings delete", removed.error);
      if (findings.length === 0) return;
      const { error } = await client.from("security_findings").insert(
        findings.map((finding) => ({
          analysis_id: analysisId,
          user_id: userId,
          category: finding.category,
          severity: finding.severity,
          file_path: finding.filePath,
          line: finding.line,
          masked_evidence: finding.maskedEvidence,
          remediation: finding.remediation,
        })),
      );
      if (error !== null) fail("security_findings insert", error);
    },

    async replaceRecommendations(analysisId: string, userId: string, rows: readonly RecommendationInsert[]) {
      const removed = await client.from("recommendations").delete().eq("analysis_id", analysisId);
      if (removed.error !== null) fail("recommendations delete", removed.error);
      if (rows.length === 0) return;
      const { error } = await client
        .from("recommendations")
        .insert(rows.map((row) => ({ ...row, analysis_id: analysisId, user_id: userId })));
      if (error !== null) fail("recommendations insert", error);
    },

    async insertUsageEvent(event: UsageEventInsert): Promise<void> {
      const { error } = await client.from("usage_events").insert({
        user_id: event.userId,
        kind: event.kind,
        tokens_in: event.tokensIn,
        tokens_out: event.tokensOut,
        ref_id: event.refId,
      });
      if (error !== null) fail("usage_events insert", error);
    },

    async getFlow(id: string): Promise<FlowRef | null> {
      const { data, error } = await client
        .from("flows")
        .select("id, user_id, recommendation_id, status")
        .eq("id", id)
        .maybeSingle();
      if (error !== null) fail("flows select", error);
      return data === null ? null : flowRefSchema.parse(data);
    },

    async getRecommendation(id: string): Promise<RecommendationRef | null> {
      const { data, error } = await client
        .from("recommendations")
        .select(
          "id, analysis_id, user_id, title, description, trigger_kind, node_types, required_credentials, rationale, source_files",
        )
        .eq("id", id)
        .maybeSingle();
      if (error !== null) fail("recommendations select", error);
      return data === null ? null : recommendationRefSchema.parse(data);
    },

    async getAnalysisContext(id: string): Promise<AnalysisContextRef | null> {
      const { data, error } = await client
        .from("analyses")
        .select("id, project_id, user_id, commit_sha, signals")
        .eq("id", id)
        .maybeSingle();
      if (error !== null) fail("analyses select", error);
      return data === null ? null : analysisContextSchema.parse(data);
    },

    async updateGeneratingFlow(id: string, patch: FlowPatch): Promise<boolean> {
      const { data, error } = await client
        .from("flows")
        .update(patch)
        .eq("id", id)
        .eq("status", "generating")
        .select("id");
      if (error !== null) fail("flows update", error);
      return Array.isArray(data) && data.length === 1;
    },
  };
}
