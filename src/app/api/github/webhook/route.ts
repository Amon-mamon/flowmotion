import { getServerEnv } from "@/lib/env.server";
import { verifyWebhookSignature } from "@/lib/github/webhook-signature";
import { ApiError, ok, withApi } from "@/server/http";
import { deleteInstallationsByGitHubId } from "@/server/installations";
import { logServerInfo } from "@/server/log";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";
import { ghWebhookInstallationEventSchema } from "@/schemas/github";

/**
 * POST /api/github/webhook — signature-verified (HMAC-SHA256, constant-time
 * compare). Handles `installation.deleted`; everything else is acknowledged.
 * The `push` → stale handler is Phase 2. Exempt from the Origin check and the
 * session check (contract sections 3 and 6).
 */
export const POST = withApi("github.webhook", async (request) => {
  await enforceIpLimit("github.webhook", request, RATE_LIMITS.webhook);

  const env = getServerEnv();
  // HMAC the exact bytes GitHub signed; decode only after verification.
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const valid = await verifyWebhookSignature(
    env.GITHUB_WEBHOOK_SECRET,
    rawBody,
    request.headers.get("x-hub-signature-256"),
  );
  if (!valid) throw new ApiError("FORBIDDEN", "Invalid webhook signature.");

  const event = request.headers.get("x-github-event") ?? "";
  const deliveryId = request.headers.get("x-github-delivery") ?? "unknown";

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Webhook body must be JSON.");
  }

  if (event === "installation") {
    const parsed = ghWebhookInstallationEventSchema.safeParse(payload);
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Unexpected installation payload.");
    if (parsed.data.action === "deleted") {
      const removed = await deleteInstallationsByGitHubId(parsed.data.installation.id);
      logServerInfo("github.webhook", {
        event,
        action: parsed.data.action,
        installationId: parsed.data.installation.id,
        removed,
        deliveryId,
      });
    }
  }

  return ok({ received: true as const });
});
