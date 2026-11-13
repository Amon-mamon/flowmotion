import { listRecommendations, resolveAnalysisId } from "@/server/analyses";
import { requireUser } from "@/server/auth";
import { toRecommendationDto } from "@/server/db-rows";
import { ApiError, ok, parseParams, parseQuery, withApi, type RouteContext } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { enforceUserLimit } from "@/server/rate-limit";
import { analysisIdQuerySchema } from "@/schemas/analysis";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/projects/:id/recommendations[?analysisId=] → { analysisId,
 * recommendations } sorted confidence desc, then title. Without a query: the
 * latest `done` analysis (null and [] when there is none).
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
    return ok({ analysisId, recommendations: rows.map(toRecommendationDto) });
  },
);
