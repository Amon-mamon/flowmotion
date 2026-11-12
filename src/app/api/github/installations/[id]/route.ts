import { audit } from "@/server/audit";
import { requireSameOrigin, requireUser } from "@/server/auth";
import { ok, parseParams, withApi, type RouteContext } from "@/server/http";
import { deleteInstallationForUser } from "@/server/installations";
import { enforceUserLimit } from "@/server/rate-limit";
import { idParamSchema } from "@/schemas/project";

/** DELETE /api/github/installations/:id → { deleted: true } */
export const DELETE = withApi<{ id: string }>(
  "github.installations.delete",
  async (request, context: RouteContext<{ id: string }>) => {
    requireSameOrigin(request);
    const user = await requireUser();
    await enforceUserLimit("github.installations.delete", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    await deleteInstallationForUser(user.id, id);
    await audit(user.id, "github.disconnect", id);
    return ok({ deleted: true as const });
  },
);
