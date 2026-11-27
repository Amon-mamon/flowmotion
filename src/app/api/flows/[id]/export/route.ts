import { NextResponse } from "next/server";

import { assertExportSafe, ExportNotSafeError, validateWorkflow } from "@/lib/validator";
import { audit } from "@/server/audit";
import { requireUser } from "@/server/auth";
import { getFlowForUser } from "@/server/flows/data";
import { exportFileName } from "@/server/flows/export";
import { ApiError, parseParams, withApi, type RouteContext } from "@/server/http";
import { logServerInfo } from "@/server/log";
import { RATE_LIMITS, enforceUserLimit } from "@/server/rate-limit";
import { idParamSchema } from "@/schemas/project";

/**
 * GET /api/flows/:id/export (Phase 3b). On success NOT the envelope: the
 * stored n8n JSON pretty-printed as an attachment. Checks: session → 10/min
 * (route `export`) → :id → owned (NOT_FOUND) → ready with JSON
 * (EXPORT_NOT_VALID) → validateWorkflow and assertExportSafe on the stored
 * JSON (D-50; EXPORT_NOT_VALID, logged by rule only) → audit `flow.export`.
 */
export const GET = withApi<{ id: string }>("flows.export", async (_request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  await enforceUserLimit("export", user.id, RATE_LIMITS.heavy);
  const { id } = parseParams(idParamSchema, await context.params);
  const row = await getFlowForUser(user.id, id);
  if (row === null) throw new ApiError("NOT_FOUND");
  if (row.status !== "ready" || row.n8n_json === null) throw new ApiError("EXPORT_NOT_VALID");

  const validation = validateWorkflow(row.n8n_json, row.setup_checklist);
  if (!validation.ok) {
    logServerInfo("flows.export", {
      flowId: row.id,
      code: "EXPORT_NOT_VALID",
      rules: validation.errors.map((error) => error.rule).join(","),
    });
    throw new ApiError("EXPORT_NOT_VALID");
  }
  try {
    assertExportSafe(row.n8n_json);
  } catch (error) {
    if (!(error instanceof ExportNotSafeError)) throw error;
    logServerInfo("flows.export", { flowId: row.id, code: "EXPORT_NOT_VALID", rule: error.rule });
    throw new ApiError("EXPORT_NOT_VALID");
  }

  await audit(user.id, "flow.export", row.id);
  return new NextResponse(`${JSON.stringify(row.n8n_json, null, 2)}\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(row.name)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
