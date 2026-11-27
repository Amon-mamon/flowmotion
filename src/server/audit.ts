import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/server/log";

/** Audit actions written in Phase 1. More arrive with later phases. */
export type AuditAction =
  | "github.connect"
  | "github.sync"
  | "github.disconnect"
  | "project.create"
  | "project.delete"
  | "analysis.start"
  | "flow.generate"
  | "flow.export";

/**
 * Appends an audit_log row. Writes go through the service role (clients have
 * select only). A failed write is logged (action only) and never breaks the
 * request that caused it.
 */
export async function audit(userId: string, action: AuditAction, ref: string | null): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("audit_log")
      .insert({ user_id: userId, action, ref });
    if (error !== null) throw new Error(`audit insert failed: ${error.code ?? "unknown"}`);
  } catch (error) {
    logServerError(`audit:${action}`, error);
  }
}
