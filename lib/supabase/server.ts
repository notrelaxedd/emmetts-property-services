import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client. It uses the service-role key, which bypasses row level security,
 * so the `bookings` table can stay fully locked to the public. Never import this from a client component.
 *
 * Returns null when env vars are missing so the form can show a friendly "call us" message instead of crashing.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
