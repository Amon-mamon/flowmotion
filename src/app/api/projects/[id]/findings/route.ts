import { listFindings, resolveAnalysisId } from "@/server/analyses";
import { requireUser } from "@/server/auth";
import { toFindingDto } from "@/server/db-rows";
import { ApiError, ok, parseParams, parseQuery, withApi, type RouteContext } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { enforceUserLimit } from "@/server/rate-limit";
import { analysisIdQuerySchema } from "@/schemas/analysis";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/projects/:id/findings[?analysisId=] → { analysisId, findings }
 * sorted severity high → low, then filePath, then line. Without a query: the
 * latest `done` analysis (null and [] when there is none).
 */
export const GET = withApi<{ id: string }>(
  "projects.findings",
  async (request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("projects.findings", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    const query = parseQuery(request.url, analysisIdQuerySchema);
    const project = await getProjectForUser(user.id, id);
    if (project === null) throw new ApiError("NOT_FOUND");
    const analysisId = await resolveAnalysisId(user.id, project.id, query.analysisId);
    if (analysisId === null) return ok({ analysisId: null, findings: [] });
    const rows = await listFindings(user.id, analysisId);
    return ok({ analysisId, findings: rows.map(toFindingDto) });
  },
);
