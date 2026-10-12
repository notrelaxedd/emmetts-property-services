import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const wantsOwner = pathname.startsWith("/admin");
  const wantsCrew = pathname.startsWith("/crew");

  if (wantsOwner || wantsCrew) {
    if (!user || !role) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
    if (wantsOwner && role !== "owner") return NextResponse.redirect(new URL("/crew", request.url));
  }
  if (pathname === "/login" && user && role) {
    return NextResponse.redirect(new URL(role === "owner" ? "/admin" : "/crew", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/crew/:path*", "/login"],
};
