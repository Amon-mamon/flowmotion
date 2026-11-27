import { requireUser } from "@/server/auth";
import { listFlowSummaries } from "@/server/flows/data";
import { ok, withApi } from "@/server/http";
import { enforceUserLimit } from "@/server/rate-limit";

/** GET /api/flows → { flows: FlowSummary[] }: the user's flows, newest first, at most 20 (Phase 3b). */
export const GET = withApi("flows.list", async () => {
  const user = await requireUser();
  await enforceUserLimit("flows.list", user.id);
  return ok({ flows: await listFlowSummaries(user.id) });
});
