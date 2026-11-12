import { audit } from "@/server/audit";
import { requireSameOrigin, requireUser } from "@/server/auth";
import { toAnalysisSummaryDto, toProjectDto } from "@/server/db-rows";
import { ApiError, ok, parseParams, withApi, type RouteContext } from "@/server/http";
import { deleteProjectForUser, getProjectForUser, listAnalysisSummaries } from "@/server/projects";
import { enforceUserLimit } from "@/server/rate-limit";
import { idParamSchema } from "@/schemas/project";

/** GET /api/projects/:id → Project & { analyses } newest first */
export const GET = withApi<{ id: string }>(
  "projects.get",
  async (_request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("projects.get", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    const row = await getProjectForUser(user.id, id);
    if (row === null) throw new ApiError("NOT_FOUND");
    const analyses = await listAnalysisSummaries(user.id, id);
    return ok({ ...toProjectDto(row), analyses: analyses.map(toAnalysisSummaryDto) });
  },
);

/** DELETE /api/projects/:id → { deleted: true } */
export const DELETE = withApi<{ id: string }>(
  "projects.delete",
  async (request, context: RouteContext<{ id: string }>) => {
    requireSameOrigin(request);
    const user = await requireUser();
    await enforceUserLimit("projects.delete", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    await deleteProjectForUser(user.id, id);
    await audit(user.id, "project.delete", id);
    return ok({ deleted: true as const });
  },
);
