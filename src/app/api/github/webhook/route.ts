import { getServerEnv } from "@/lib/env.server";
import { verifyWebhookSignature } from "@/lib/github/webhook-signature";
import { ApiError, ok, withApi } from "@/server/http";
import { handlePushEvent } from "@/server/github/push";
import { deleteInstallationsByGitHubId, revokeInstallationRepos } from "@/server/installations";
import { logServerInfo } from "@/server/log";
import { RATE_LIMITS, enforceIpLimit } from "@/server/rate-limit";
import {
  ghWebhookInstallationEventSchema,
  ghWebhookInstallationRepositoriesEventSchema,
  ghWebhookPushEventSchema,
} from "@/schemas/github";

/**
 * POST /api/github/webhook — signature-verified (HMAC-SHA256, constant-time
 * compare). Handles `installation.deleted` and `push` (stale on the
 * project's chosen branch); everything else is acknowledged. Exempt from the Origin check and the
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

  if (event === "push") {
    const parsed = ghWebhookPushEventSchema.safeParse(payload);
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Unexpected push payload.");
    const updated = await handlePushEvent(parsed.data);
    logServerInfo("github.webhook", {
      event,
      installationId: parsed.data.installation.id,
      updated,
      deliveryId,
    });
  }

  if (event === "installation_repositories") {
    const parsed = ghWebhookInstallationRepositoriesEventSchema.safeParse(payload);
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Unexpected installation_repositories payload.");
    // D-22: `removed` revokes for every user; `added` waits for each user's refresh.
    if (parsed.data.action === "removed") {
      const revoked = await revokeInstallationRepos(
        parsed.data.installation.id,
        (parsed.data.repositories_removed ?? []).map((repo) => repo.id),
      );
      logServerInfo("github.webhook", {
        event,
        action: parsed.data.action,
        installationId: parsed.data.installation.id,
        revoked,
        deliveryId,
      });
    }
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
