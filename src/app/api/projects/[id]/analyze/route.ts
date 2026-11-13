import { audit } from "@/server/audit";
import { requireSameOrigin, requireUser } from "@/server/auth";
import {
  ANALYSIS_ALREADY_RUNNING,
  RECONNECT_TO_ANALYZE,
  createAnalysisWithJob,
  hasActiveAnalysis,
  setProjectRepoId,
} from "@/server/analyses";
import { enforceDailyCap } from "@/server/daily-cap";
import { refreshRequired, requireRepoAccess } from "@/server/github/repo-access";
import { ApiError, ok, parseParams, withApi, type RouteContext } from "@/server/http";
import { expireStaleJobs, scheduleWorkerTrigger } from "@/server/jobs/trigger";
import { getProjectForUser } from "@/server/projects";
import { RATE_LIMITS, enforceUserLimit } from "@/server/rate-limit";
import { idParamSchema } from "@/schemas/project";

/**
 * POST /api/projects/:id/analyze (no body) → { analysisId } 202.
 * Check order (contract section 6): session → Origin → 10/min → :id →
 * project owned → installation present → repository access (D-22, before any
 * GitHub call or insert; access row name must match, S2-1) →
 * expire_stale_jobs() (D-29) → no active analysis → daily cap → insert analysis
 * (branch copied from the project) + job → trigger the worker → audit.
 */
export const POST = withApi<{ id: string }>(
  "projects.analyze",
  async (request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    requireSameOrigin(request);
    await enforceUserLimit("projects.analyze", user.id, RATE_LIMITS.heavy);
    const { id } = parseParams(idParamSchema, await context.params);

    const project = await getProjectForUser(user.id, id);
    if (project === null) throw new ApiError("NOT_FOUND");
    if (project.installation_id === null) throw new ApiError("VALIDATION_ERROR", RECONNECT_TO_ANALYZE);

    const access = await requireRepoAccess(user.id, project.installation_id, {
      repoId: project.repo_id,
      fullName: project.repo_full_name,
    });
    // S2-1 (D-32): the access row must still carry the project's name; a
    // renamed repo must be added again.
    if (access.repo_full_name.toLowerCase() !== project.repo_full_name.toLowerCase()) {
      throw refreshRequired();
    }
    if (project.repo_id === null) await setProjectRepoId(user.id, project.id, access.repo_id);

    // D-29: an expired chain never blocks re-analysis.
    await expireStaleJobs();

    if (await hasActiveAnalysis(user.id, project.id)) {
      throw new ApiError("VALIDATION_ERROR", ANALYSIS_ALREADY_RUNNING);
    }
    await enforceDailyCap(user.id, "analyze");

    const analysisId = await createAnalysisWithJob({
      userId: user.id,
      projectId: project.id,
      branch: project.branch,
      nowIso: new Date().toISOString(),
    });
    scheduleWorkerTrigger({ userId: user.id });
    await audit(user.id, "analysis.start", analysisId);
    return ok({ analysisId }, 202);
  },
);
