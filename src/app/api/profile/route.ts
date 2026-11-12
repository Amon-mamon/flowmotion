import { requireSameOrigin, requireUser } from "@/server/auth";
import { ok, parseJsonBody, withApi } from "@/server/http";
import { getProfile, updateDisplayName } from "@/server/profile";
import { enforceUserLimit } from "@/server/rate-limit";
import { updateProfileBodySchema } from "@/schemas/profile";

/** GET /api/profile → Profile */
export const GET = withApi("profile.get", async () => {
  const user = await requireUser();
  await enforceUserLimit("profile.get", user.id);
  return ok(await getProfile(user));
});

/** PATCH /api/profile { displayName } → Profile */
export const PATCH = withApi("profile.update", async (request) => {
  requireSameOrigin(request);
  const user = await requireUser();
  await enforceUserLimit("profile.update", user.id);
  const body = await parseJsonBody(request, updateProfileBodySchema);
  return ok(await updateDisplayName(user, body.displayName));
});
