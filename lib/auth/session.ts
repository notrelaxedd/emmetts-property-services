import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/db/types";

export type Session = { userId: string; email: string | null; profile: Profile };

/** Current signed-in user + profile, or null. */
export async function getSession(): Promise<Session | null> {
  const supabase = createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (!profile) return null;
  return { userId: user.id, email: user.email ?? null, profile: profile as Profile };
}

/** Redirects to /login unless the user has one of the allowed roles. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!roles.includes(session.profile.role)) redirect(session.profile.role === "owner" ? "/admin" : "/crew");
  return session;
}

export const requireOwner = () => requireRole("owner");
export const requireCrew = () => requireRole("crew", "owner");
