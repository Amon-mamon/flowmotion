import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env.server";

/**
 * Service-role Supabase client. Bypasses RLS. Server-only: never import from
 * client code and never expose through NEXT_PUBLIC_ values. Construction only.
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
