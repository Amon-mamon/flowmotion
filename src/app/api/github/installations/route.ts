import { requireUser } from "@/server/auth";
import { toInstallationDto } from "@/server/db-rows";
import { ok, withApi } from "@/server/http";
import { listInstallationsForUser } from "@/server/installations";
import { enforceUserLimit } from "@/server/rate-limit";

/** GET /api/github/installations → { installations: Installation[] } */
export const GET = withApi("github.installations.list", async () => {
  const user = await requireUser();
  await enforceUserLimit("github.installations.list", user.id);
  const rows = await listInstallationsForUser(user.id);
  return ok({ installations: rows.map(toInstallationDto) });
});
