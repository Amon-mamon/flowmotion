import { requireUser } from "@/server/auth";
import { getFlowForUser, linksForFlows } from "@/server/flows/data";
import { buildFlowDetail } from "@/server/flows/view";
import { ApiError, ok, parseParams, withApi, type RouteContext } from "@/server/http";
import { pollKick } from "@/server/jobs/trigger";
import { enforceUserLimit } from "@/server/rate-limit";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/flows/:id → FlowDetail (Phase 3b). NOT_FOUND unless it is the
 * user's. While the flow is generating, a stalled job gets one worker trigger
 * and an idle one is expired (poll kick, contract section 4). Never checks
 * repository access (derived data).
 */
export const GET = withApi<{ id: string }>("flows.get", async (_request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  await enforceUserLimit("flows.get", user.id);
  const { id } = parseParams(idParamSchema, await context.params);
  let row = await getFlowForUser(user.id, id);
  if (row === null) throw new ApiError("NOT_FOUND");
  if (row.status === "generating" && (await pollKick(user.id, row.id, "generate")) === "expired") {
    row = (await getFlowForUser(user.id, id)) ?? row;
  }
  const links = (await linksForFlows(user.id, [row])).get(row.id);
  if (links === undefined) throw new ApiError("NOT_FOUND");
  return ok(buildFlowDetail(row, links));
});
