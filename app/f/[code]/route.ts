import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { FLYER_COOKIE, FLYER_COOKIE_MAX_AGE, flyerLandingPath, isBot, normalizeCode } from "@/lib/flyers/codes";
import { clientIpFrom, createRateLimiter } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// One phone re-scanning (or a script) shouldn't pile up scan rows; it still gets redirected.
const scanLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

/**
 * A flyer worker's QR code: /f/<code>. Logs the scan, remembers the code in a cookie (so a quote
 * submitted later still counts) and lands on the quote form tagged utm_source=flyer. Unknown codes
 * and any database trouble still land on the quote form: a scan must never dead-end.
 */
export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const code = normalizeCode(params.code);
  if (!code) return NextResponse.redirect(new URL("/quote", request.url), 302);
  const response = NextResponse.redirect(new URL(flyerLandingPath(code), request.url), 302);

  const db = getSupabaseAdmin();
  if (!db) return response;
  try {
    const { data: worker, error } = await db.from("flyer_workers").select("id").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    if (!worker) return response;

    response.cookies.set(FLYER_COOKIE, code, {
      maxAge: FLYER_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });

    const ua = request.headers.get("user-agent");
    const ip = clientIpFrom(request.headers);
    if (!isBot(ua) && scanLimiter.hit(`${ip}:${code}`).ok) {
      const visitor = createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
      const { error: insertError } = await db.from("flyer_scans").insert({ flyer_worker_id: worker.id, visitor });
      if (insertError) throw new Error(insertError.message);
    }
  } catch (e) {
    console.error("[flyer] scan not recorded:", e instanceof Error ? e.message : e);
  }
  return response;
}
