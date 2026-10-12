import "server-only"
import type { createSupabaseServerClient } from "@/lib/supabase/server"
import type { Role } from "@/lib/db/types"

type Client = NonNullable<ReturnType<typeof createSupabaseServerClient>>

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null
  if (/[\u0000-\u001f]/.test(next)) return null
  return next
}

/** Where a signed-in user lands by default: owners to /admin, crew to /crew, others null. */
export async function homeForCurrentUser(supabase: Client): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
  const role = (data?.role as Role | undefined) ?? null
  if (!role) return null
  return role === "owner" ? "/admin" : "/crew"
}
