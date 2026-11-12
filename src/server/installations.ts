import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  INSTALLATION_COLUMNS,
  installationRowSchema,
  type InstallationRow,
} from "@/server/db-rows";
import { ApiError } from "@/server/http";

/**
 * github_installations access. Reads use the user's session client (RLS
 * owner-only select); writes use the service role with an explicit user_id.
 */

export async function listInstallationsForUser(userId: string): Promise<InstallationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_installations")
    .select(INSTALLATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error(`installations select failed: ${error.code ?? "unknown"}`);
  return z.array(installationRowSchema).parse(data);
}

export async function getInstallationForUser(
  userId: string,
  id: string,
): Promise<InstallationRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("github_installations")
    .select(INSTALLATION_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error !== null) throw new Error(`installation select failed: ${error.code ?? "unknown"}`);
  if (data === null) return null;
  return installationRowSchema.parse(data);
}

/** Upsert on (user_id, installation_id); returns the row. */
export async function upsertInstallation(input: {
  userId: string;
  installationId: number;
  accountLogin: string;
}): Promise<InstallationRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("github_installations")
    .upsert(
      {
        user_id: input.userId,
        installation_id: input.installationId,
        account_login: input.accountLogin,
      },
      { onConflict: "user_id,installation_id" },
    )
    .select(INSTALLATION_COLUMNS)
    .single();
  if (error !== null) throw new Error(`installation upsert failed: ${error.code ?? "unknown"}`);
  return installationRowSchema.parse(data);
}

/** Deletes the user's row; projects get installation_id = null via FK. */
export async function deleteInstallationForUser(userId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("github_installations")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");
  if (error !== null) throw new Error(`installation delete failed: ${error.code ?? "unknown"}`);
  const deleted = z.array(z.object({ id: z.uuid() })).parse(data);
  if (deleted.length === 0) throw new ApiError("NOT_FOUND");
}

/** Webhook `installation.deleted`: removes every row with that GitHub id. */
export async function deleteInstallationsByGitHubId(installationId: number): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("github_installations")
    .delete()
    .eq("installation_id", installationId)
    .select("id");
  if (error !== null) throw new Error(`installation delete failed: ${error.code ?? "unknown"}`);
  return z.array(z.object({ id: z.uuid() })).parse(data).length;
}
