import { getBranch } from "@/lib/github/client";
import { audit } from "@/server/audit";
import { requireSameOrigin, requireUser } from "@/server/auth";
import { toProjectDto } from "@/server/db-rows";
import { mapGitHubError } from "@/server/github/app";
import {
  BRANCH_NOT_FOUND_MESSAGE,
  REPO_NOT_COVERED_MESSAGE,
  requireRepoAccess,
  resolveCoveredRepo,
  type CoveredRepo,
} from "@/server/github/repo-access";
import { ApiError, ok, parseJsonBody, withApi } from "@/server/http";
import { getInstallationForUser } from "@/server/installations";
import { createProject, listProjectsForUser } from "@/server/projects";
import { enforceUserLimit } from "@/server/rate-limit";
import { createProjectBodySchema } from "@/schemas/project";

/** GET /api/projects → { projects: Project[] } newest first */
export const GET = withApi("projects.list", async () => {
  const user = await requireUser();
  await enforceUserLimit("projects.list", user.id);
  const rows = await listProjectsForUser(user.id);
  return ok({ projects: rows.map(toProjectDto) });
});

/** POST /api/projects { repoFullName, installationId, branch } → Project (201) */
export const POST = withApi("projects.create", async (request) => {
  requireSameOrigin(request);
  const user = await requireUser();
  await enforceUserLimit("projects.create", user.id);
  const body = await parseJsonBody(request, createProjectBodySchema);

  const installation = await getInstallationForUser(user.id, body.installationId);
  if (installation === null) {
    throw new ApiError("VALIDATION_ERROR", "Unknown GitHub installation.");
  }

  // D-22: the repo must be in this user's fresh access set before any GitHub call.
  const access = await requireRepoAccess(user.id, installation.id, { fullName: body.repoFullName });

  let covered: CoveredRepo | null;
  let branch: { name: string; headSha: string } | null;
  try {
    covered = await resolveCoveredRepo(installation.installation_id, body.repoFullName, access.repo_id);
    branch = covered === null ? null : await getBranch({ token: covered.token }, covered.repo.fullName, body.branch);
  } catch (error) {
    throw mapGitHubError("projects.create", error);
  }
  if (covered === null) throw new ApiError("VALIDATION_ERROR", REPO_NOT_COVERED_MESSAGE);
  if (branch === null) throw new ApiError("VALIDATION_ERROR", BRANCH_NOT_FOUND_MESSAGE);

  const row = await createProject({
    userId: user.id,
    installationRowId: installation.id,
    repoFullName: covered.repo.fullName,
    repoId: covered.repo.id,
    defaultBranch: covered.repo.defaultBranch,
    // Store GitHub's spelling of the branch, not the request's.
    branch: branch.name,
  });
  await audit(user.id, "project.create", row.id);
  return ok(toProjectDto(row), 201);
});
