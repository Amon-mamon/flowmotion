import { getInstallationRepo } from "@/lib/github/client";
import { audit } from "@/server/audit";
import { requireSameOrigin, requireUser } from "@/server/auth";
import { toProjectDto } from "@/server/db-rows";
import { mapGitHubError, mintInstallationToken, repoInstallationId } from "@/server/github/app";
import { ApiError, ok, parseJsonBody, withApi } from "@/server/http";
import { getInstallationForUser } from "@/server/installations";
import { createProject, listProjectsForUser } from "@/server/projects";
import { enforceUserLimit } from "@/server/rate-limit";
import type { Repo } from "@/schemas/github";
import { createProjectBodySchema } from "@/schemas/project";

/** GET /api/projects → { projects: Project[] } newest first */
export const GET = withApi("projects.list", async () => {
  const user = await requireUser();
  await enforceUserLimit("projects.list", user.id);
  const rows = await listProjectsForUser(user.id);
  return ok({ projects: rows.map(toProjectDto) });
});

/** POST /api/projects { repoFullName, installationId } → Project (201) */
export const POST = withApi("projects.create", async (request) => {
  requireSameOrigin(request);
  const user = await requireUser();
  await enforceUserLimit("projects.create", user.id);
  const body = await parseJsonBody(request, createProjectBodySchema);

  const installation = await getInstallationForUser(user.id, body.installationId);
  if (installation === null) {
    throw new ApiError("VALIDATION_ERROR", "Unknown GitHub installation.");
  }

  let repo: Repo | null;
  try {
    const { token } = await mintInstallationToken(installation.installation_id);
    repo = await getInstallationRepo({ token }, body.repoFullName);
    // An installation token can read any public repo, so also require that
    // this installation is the one covering the repo (review R1-14).
    if (repo !== null && (await repoInstallationId(repo.fullName)) !== installation.installation_id) {
      repo = null;
    }
  } catch (error) {
    throw mapGitHubError("projects.create", error);
  }
  if (repo === null) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "This repository is not available through the selected GitHub installation.",
    );
  }

  const row = await createProject({
    userId: user.id,
    installationRowId: installation.id,
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
  });
  await audit(user.id, "project.create", row.id);
  return ok(toProjectDto(row), 201);
});
