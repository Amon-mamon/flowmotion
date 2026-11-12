import "server-only";

import { createClient } from "@/lib/supabase/server";
import { profileRowSchema, toProfileDto } from "@/server/db-rows";
import { ApiError } from "@/server/http";
import type { Profile } from "@/schemas/profile";
import type { SessionUser } from "@/server/auth";

export async function getProfile(user: SessionUser): Promise<Profile> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (error !== null) throw new Error(`profile select failed: ${error.code ?? "unknown"}`);
  if (data === null) throw new ApiError("NOT_FOUND", "Profile not found.");
  return toProfileDto(profileRowSchema.parse(data), user.email);
}

/** Uses the session client: the owner has an update grant on display_name only. */
export async function updateDisplayName(user: SessionUser, displayName: string): Promise<Profile> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id)
    .select("id, display_name")
    .maybeSingle();
  if (error !== null) throw new Error(`profile update failed: ${error.code ?? "unknown"}`);
  if (data === null) throw new ApiError("NOT_FOUND", "Profile not found.");
  return toProfileDto(profileRowSchema.parse(data), user.email);
}
