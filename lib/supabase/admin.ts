import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it is for server actions, route handlers and workers only.
 * Never import from a client component (the `server-only` import makes that a build error).
 * Returns null when env is missing so public pages degrade to "call us" instead of crashing.
 */
export function getSupabaseAdmin(): AdminClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function requireSupabaseAdmin(): AdminClient {
  const c = getSupabaseAdmin();
  if (!c) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  return c;
}
