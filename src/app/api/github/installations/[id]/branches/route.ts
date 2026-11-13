import { listRepoBranches } from "@/lib/github/client";
import { requireUser } from "@/server/auth";
import { mapGitHubError } from "@/server/github/app";
import {
  REPO_NOT_COVERED_MESSAGE,
  requireRepoAccess,
  resolveCoveredRepo,
} from "@/server/github/repo-access";
import { ApiError, ok, parseParams, parseQuery, withApi, type RouteContext } from "@/server/http";
import { getInstallationForUser } from "@/server/installations";
import { logServerInfo } from "@/server/log";
import { enforceUserLimit } from "@/server/rate-limit";
import { branchesQuerySchema, type BranchesResponse } from "@/schemas/github";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/github/installations/:id/branches?repo=<owner/name>&page=<n>
 * → BranchesResponse (contract section 6). The repo must be in the user's
 * fresh access set (D-22) before any GitHub call, then covered by this
 * installation with the same repo id.
 */
export const GET = withApi<{ id: string }>(
  "github.installations.branches",
  async (request, context: RouteContext<{ id: string }>) => {
    const user = await requireUser();
    await enforceUserLimit("github.installations.branches", user.id);
    const { id } = parseParams(idParamSchema, await context.params);
    const { repo, page } = parseQuery(request.url, branchesQuerySchema);

    const installation = await getInstallationForUser(user.id, id);
    if (installation === null) throw new ApiError("NOT_FOUND");

    const access = await requireRepoAccess(user.id, installation.id, { fullName: repo });

    let response: BranchesResponse;
    try {
      const covered = await resolveCoveredRepo(installation.installation_id, repo, access.repo_id);
      if (covered === null) throw new ApiError("VALIDATION_ERROR", REPO_NOT_COVERED_MESSAGE);
      const result = await listRepoBranches({ token: covered.token }, covered.repo.fullName, page);
      if (result.skipped > 0) {
        logServerInfo("github.installations.branches", { userId: user.id, skippedBranchNames: result.skipped });
      }
      response = {
        branches: result.branches,
        defaultBranch: covered.repo.defaultBranch,
        page,
        hasMore: result.hasMore,
      };
    } catch (error) {
      throw mapGitHubError("github.installations.branches", error);
    }
    return ok(response);
  },
);
