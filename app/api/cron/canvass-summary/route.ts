import { NextResponse, type NextRequest } from "next/server"
import { runNightlySummary, yesterdayLocal } from "@/lib/canvass/summary"
import { getSupabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Nightly canvass summary (vercel.json: `0 10 * * *` = 06:00 America/New_York). Vercel calls it with
 * `Authorization: Bearer <CRON_SECRET>`; anything else gets 401. Summarises yesterday (Ohio time), or `?date=YYYY-MM-DD`
 * for a re-run. A day without knocks stores a minimal summary and never calls the model.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 503 })

  const requested = request.nextUrl.searchParams.get("date")
  const forDate = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : yesterdayLocal()
  try {
    const result = await runNightlySummary(db, forDate, { worker: "cron" })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[canvass] nightly summary failed:", message)
    return NextResponse.json({ ok: false, for_date: forDate, error: message }, { status: 500 })
  }
}
