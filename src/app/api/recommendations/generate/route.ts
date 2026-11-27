import { audit } from "@/server/audit";
import { setProjectRepoId } from "@/server/analyses";
import { requireSameOrigin, requireUser } from "@/server/auth";
import { enforceDailyCap } from "@/server/daily-cap";
import {
  FLOW_EXISTS_MESSAGE,
  ONE_ANALYSIS_MESSAGE,
  RECONNECT_TO_GENERATE,
  createFlowsWithJobs,
  getAnalysisRefForUser,
  getRecommendationsForUser,
  hasActiveFlow,
} from "@/server/flows/data";
import { refreshRequired, requireRepoAccess } from "@/server/github/repo-access";
import { ApiError, ok, parseJsonBody, withApi } from "@/server/http";
import { expireStaleJobs, scheduleWorkerTrigger } from "@/server/jobs/trigger";
import { getProjectForUser } from "@/server/projects";
import { RATE_LIMITS, enforceUserLimit } from "@/server/rate-limit";
import { generateBodySchema } from "@/schemas/flow";

/**
 * POST /api/recommendations/generate `GenerateBody` → `{ flowIds }` 202
 * (Phase 3b). All-or-nothing. Check order (contract section 6): session →
 * Origin → 10/min (route `generate`) → body → every recommendation is the
 * user's (NOT_FOUND) and from one analysis → installation present →
 * repository access + S2-1 name match (GITHUB_REFRESH_REQUIRED) → no
 * generating/ready flow → stale analysis unless allowStale → daily cap
 * (counted per recommendation, consumed last) → insert flows + jobs → trigger
 * the worker → audit `flow.generate` per flow.
 */
export const POST = withApi("recommendations.generate", async (request) => {
  const user = await requireUser();
  requireSameOrigin(request);
  await enforceUserLimit("generate", user.id, RATE_LIMITS.heavy);
  const body = await parseJsonBody(request, generateBodySchema);
  const ids = body.recommendationIds;

  const recs = await getRecommendationsForUser(user.id, ids);
  if (recs.length !== ids.length) throw new ApiError("NOT_FOUND");
  const analysisIds = new Set(recs.map((rec) => rec.analysis_id));
  if (analysisIds.size !== 1) throw new ApiError("VALIDATION_ERROR", ONE_ANALYSIS_MESSAGE);
  const [analysisId] = [...analysisIds];
  if (analysisId === undefined) throw new ApiError("NOT_FOUND");

  const analysis = await getAnalysisRefForUser(user.id, analysisId);
  if (analysis === null) throw new ApiError("NOT_FOUND");
  const project = await getProjectForUser(user.id, analysis.project_id);
  if (project === null) throw new ApiError("NOT_FOUND");
  if (project.installation_id === null) throw new ApiError("VALIDATION_ERROR", RECONNECT_TO_GENERATE);

  // Generation re-reads repository files, so it needs the same access as analyze.
  const access = await requireRepoAccess(user.id, project.installation_id, {
    repoId: project.repo_id,
    fullName: project.repo_full_name,
  });
  if (access.repo_full_name.toLowerCase() !== project.repo_full_name.toLowerCase()) throw refreshRequired();
  if (project.repo_id === null) await setProjectRepoId(user.id, project.id, access.repo_id);

  // D-29 (OQ-34): an expired generating flow must not block a new attempt.
  await expireStaleJobs();
  if (await hasActiveFlow(user.id, ids)) throw new ApiError("VALIDATION_ERROR", FLOW_EXISTS_MESSAGE);

  if (analysis.commit_sha !== project.last_commit_sha && body.allowStale !== true) {
    throw new ApiError("PROJECT_STALE_ANALYSIS");
  }

  await enforceDailyCap(user.id, "generate", ids.length);

  const byId = new Map(recs.map((rec) => [rec.id, rec]));
  const flowIds = await createFlowsWithJobs({
    userId: user.id,
    recommendations: ids.map((id) => {
      const rec = byId.get(id);
      if (rec === undefined) throw new ApiError("NOT_FOUND");
      return { id: rec.id, title: rec.title };
    }),
  });
  scheduleWorkerTrigger({ userId: user.id });
  for (const flowId of flowIds) await audit(user.id, "flow.generate", flowId);
  return ok({ flowIds }, 202);
});
