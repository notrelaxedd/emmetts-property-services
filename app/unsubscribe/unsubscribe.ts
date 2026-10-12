import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type UnsubscribeResult = "ok" | "not_found" | "unavailable" | "error";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Turns off email, SMS and snow-list for the customer holding this `unsubscribe_token`. No auth:
 * the token is the secret. Idempotent, so email scanners that prefetch the link do no extra harm
 * beyond unsubscribing (which is the safe direction).
 */
export async function unsubscribeByToken(token: string | null | undefined): Promise<UnsubscribeResult> {
  if (!token || !TOKEN_RE.test(token)) return "not_found";
  const db = getSupabaseAdmin();
  if (!db) return "unavailable";
  try {
    const { data, error } = await db
      .from("customers")
      .update({ email_opt_in: false, sms_opt_in: false, snow_list: false })
      .eq("unsubscribe_token", token)
      .select("id");
    if (error) {
      console.error("[unsubscribe] update failed:", error.message);
      return "error";
    }
    return data && data.length > 0 ? "ok" : "not_found";
  } catch (e) {
    console.error("[unsubscribe] failed:", e instanceof Error ? e.message : e);
    return "error";
  }
}
