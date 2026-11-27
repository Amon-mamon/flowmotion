import { listRecommendations, resolveAnalysisId } from "@/server/analyses";
import { requireUser } from "@/server/auth";
import { toRecommendationDto } from "@/server/db-rows";
import { newestFlowsByRecommendation } from "@/server/flows/data";
import { ApiError, ok, parseParams, parseQuery, withApi, type RouteContext } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { enforceUserLimit } from "@/server/rate-limit";
import { analysisIdQuerySchema } from "@/schemas/analysis";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/projects/:id/recommendations[?analysisId=] → { analysisId,
 * recommendations } sorted confidence desc, then title. Without a query: the
 * latest `done` analysis (null and [] when there is none). Phase 3b (D-41):
 * `status` and `flowId` are derived from each recommendation's newest flow.
 */
export const GET = withApi<{ id: string }>(
  "projects.recommendations",
  async (request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("projects.recommendations", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    const query = parseQuery(request.url, analysisIdQuerySchema);
    const project = await getProjectForUser(user.id, id);
    if (project === null) throw new ApiError("NOT_FOUND");
    const analysisId = await resolveAnalysisId(user.id, project.id, query.analysisId);
    if (analysisId === null) return ok({ analysisId: null, recommendations: [] });
    const rows = await listRecommendations(user.id, analysisId);
    // D-41: status and flowId from each recommendation's newest flow, one query for the list.
    const newest = await newestFlowsByRecommendation(
      user.id,
      rows.map((row) => row.id),
    );
    return ok({ analysisId, recommendations: rows.map((row) => toRecommendationDto(row, newest.get(row.id))) });
  },
);
