import { listInstallationRepos } from "@/lib/github/client";
import { requireUser } from "@/server/auth";
import { mapGitHubError, mintInstallationToken } from "@/server/github/app";
import { ApiError, ok, parseParams, parseQuery, withApi, type RouteContext } from "@/server/http";
import { getInstallationForUser } from "@/server/installations";
import { enforceUserLimit } from "@/server/rate-limit";
import { reposQuerySchema } from "@/schemas/github";
import { idParamSchema } from "@/schemas/project";

/** GET /api/github/installations/:id/repos?page=1 → { repos, page, hasMore } */
export const GET = withApi<{ id: string }>(
  "github.installations.repos",
  async (request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("github.installations.repos", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    const { page } = parseQuery(request.url, reposQuerySchema);

    const installation = await getInstallationForUser(user.id, id);
    if (installation === null) throw new ApiError("NOT_FOUND");

    try {
      const { token } = await mintInstallationToken(installation.installation_id);
      const result = await listInstallationRepos({ token }, page);
      return ok({ repos: result.repos, page: result.page, hasMore: result.hasMore });
    } catch (error) {
      throw mapGitHubError("github.installations.repos", error);
    }
  },
);
