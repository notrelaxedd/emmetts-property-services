import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database, Role } from "@/lib/db/types";

/**
 * Refreshes the Supabase session cookie and returns the current user's role (from `profiles`).
 * Used by `middleware.ts` to gate /admin (owner) and /crew (crew or owner).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { response, user: null, role: null as Role | null };

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: Role | null = null;
  if (user) {
    const { data } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
    role = (data?.role as Role | undefined) ?? null;
  }
  return { response, user, role };
}
