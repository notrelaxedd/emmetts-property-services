import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { logActionRequest } from "@/lib/action-requests";
import { updateSession } from "@/lib/supabase/middleware";

/** Only same-site relative paths may be used as a post-login destination. */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

const SIGNED_IN_AREAS = /^\/(admin|crew|account|login)(\/|$)/;

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;

  // A server-action POST to a public page (see the second matcher below): record who sent it before
  // Next.js looks the action up, since a rejected one never reaches our code. Never blocks the request.
  if (request.headers.has("next-action") && !SIGNED_IN_AREAS.test(pathname)) {
    event.waitUntil(logActionRequest(request));
    return NextResponse.next();
  }

  const { response, user, role } = await updateSession(request);

  const wantsOwner = pathname.startsWith("/admin");
  const wantsCrew = pathname.startsWith("/crew");
  const wantsAccount = pathname.startsWith("/account");

  if (wantsOwner || wantsCrew || wantsAccount) {
    if (!user || !role) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", wantsAccount ? `${pathname}${search}` : pathname);
      return NextResponse.redirect(login);
    }
    if (wantsOwner && role !== "owner") return NextResponse.redirect(new URL("/crew", request.url));
  }
  if (pathname === "/login" && user && role) {
    const next = safeNext(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(next ?? (role === "owner" ? "/admin" : "/crew"), request.url));
  }
  return response;
}

export const config = {
  // /account is here so a session refreshed while rendering the password page is written back to the
  // browser (server components can't set cookies; the middleware can).
  // The last entry: server-action POSTs to every other page, logged to `action_requests`.
  matcher: [
    "/admin/:path*",
    "/crew/:path*",
    "/account/:path*",
    "/login",
    { source: "/((?!_next/|admin|crew|account|login).*)", has: [{ type: "header", key: "next-action" }] },
  ],
};
