import { getAnalysisForUser } from "@/server/analyses";
import { requireUser } from "@/server/auth";
import { toAnalysisDto } from "@/server/db-rows";
import { ApiError, ok, parseParams, withApi, type RouteContext } from "@/server/http";
import { pollKick } from "@/server/jobs/trigger";
import { enforceUserLimit } from "@/server/rate-limit";
import { isActiveAnalysisStatus } from "@/schemas/analysis";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/analyses/:id → Analysis. NOT_FOUND unless it is the user's.
 * While the analysis is active, a stalled job gets one worker trigger (poll
 * kick, contract section 4), which also drives the local dev runner.
 */
export const GET = withApi<{ id: string }>(
  "analyses.get",
  async (_request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("analyses.get", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    let row = await getAnalysisForUser(user.id, id);
    if (row === null) throw new ApiError("NOT_FOUND");
    if (isActiveAnalysisStatus(row.status)) {
      // D-29: an expired chain is failed (JOB_EXPIRED) before the response is built.
      if ((await pollKick(user.id, row.id)) === "expired") {
        row = (await getAnalysisForUser(user.id, id)) ?? row;
      }
    }
    return ok(toAnalysisDto(row));
  },
);
