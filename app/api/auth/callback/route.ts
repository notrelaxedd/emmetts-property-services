import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { homeForCurrentUser, safeNext } from "@/app/login/redirects"

export const dynamic = "force-dynamic"

/** Magic-link landing: exchange the code for a session cookie, then send the user on their way. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = safeNext(searchParams.get("next"))

  const fail = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, request.url))

  const supabase = createSupabaseServerClient()
  if (!supabase) return fail("config")

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return fail("link")
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error) return fail("link")
  } else {
    return fail("link")
  }

  const home = await homeForCurrentUser(supabase)
  if (!home) {
    await supabase.auth.signOut()
    return fail("no-access")
  }
  // Invites and password recoveries (e.g. sent from the Supabase dashboard) go to the password page.
  if (!next && (type === "invite" || type === "recovery")) {
    return NextResponse.redirect(new URL("/account/password?welcome=1", request.url))
  }
  return NextResponse.redirect(new URL(next ?? home, request.url))
}
