import { createClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/server/auth";
import { ok, withApi } from "@/server/http";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";

/** POST /api/auth/sign-out → `{ signedOut: true }`; clears the session cookies. */
export const POST = withApi("auth.sign-out", async (request) => {
  requireSameOrigin(request);
  await enforceIpLimit("auth.sign-out", request, RATE_LIMITS.auth);
  const supabase = await createClient();
  // Local scope: clear this browser's cookies even if the token is already gone.
  await supabase.auth.signOut({ scope: "local" });
  return ok({ signedOut: true as const });
});
