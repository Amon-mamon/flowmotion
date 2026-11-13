import { requireUser } from "@/server/auth";
import { listAccessibleRepos } from "@/server/github/repo-access";
import { ApiError, ok, parseParams, parseQuery, withApi, type RouteContext } from "@/server/http";
import { getInstallationForUser } from "@/server/installations";
import { enforceUserLimit } from "@/server/rate-limit";
import { reposQuerySchema } from "@/schemas/github";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/github/installations/:id/repos?page=1 → { repos, page, hasMore }.
 * Served from the user's own repo access set (D-22), never from GitHub:
 * the installation token would list every repo of the installation.
 */
export const GET = withApi<{ id: string }>(
  "github.installations.repos",
  async (request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("github.installations.repos", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    const { page } = parseQuery(request.url, reposQuerySchema);

    const installation = await getInstallationForUser(user.id, id);
    if (installation === null) throw new ApiError("NOT_FOUND");

    return ok(await listAccessibleRepos(user.id, installation.id, installation.repos_synced_at, page));
  },
);
