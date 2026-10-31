import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { activeHangerCode, recordHangerScan } from "@/lib/canvass/hanger-events";
import { HANGER_COOKIE, HANGER_COOKIE_MAX_AGE, hangerLandingPath, normalizeHangerCode } from "@/lib/canvass/hangers";
import { isBot } from "@/lib/flyers/codes";
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// One phone re-scanning (or a script) shouldn't pile up scan rows; it still gets redirected.
const scanLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

/**
 * A door hanger's QR code: /h/<code>. Logs the scan, remembers the code in a cookie (so a quote submitted days
 * later still counts for that street) and lands on the quote form tagged src=hanger / utm_source=hanger. Unknown or
 * inactive codes and any database trouble still land on the quote form: a scan must never dead-end.
 */
export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const code = normalizeHangerCode(params.code);
  if (!code) return NextResponse.redirect(new URL("/quote", request.url), 302);
  const response = NextResponse.redirect(new URL(hangerLandingPath(code), request.url), 302);

  const db = getSupabaseAdmin();
  if (!db) return response;
  try {
    const row = await activeHangerCode(db, code);
    if (!row) return response;

    response.cookies.set(HANGER_COOKIE, row.code, {
      maxAge: HANGER_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });

    const ua = request.headers.get("user-agent");
    const ip = clientIpFrom(request.headers);
    if (!isBot(ua) && scanLimiter.hit(`${ip}:${row.code}`).ok) {
      const visitor = createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
      await recordHangerScan(db, row.code, visitor, { verified: true });
    }
  } catch (e) {
    console.error("[hanger] scan not recorded:", e instanceof Error ? e.message : e);
  }
  return response;
}
