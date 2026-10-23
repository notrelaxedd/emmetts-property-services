import { NextResponse } from "next/server"
import { requireOwner } from "@/lib/auth/session"
import { coveredStreetsInView, ensureStreets, streetsInView } from "@/lib/flyers/street-data"
import { MAX_COVERED_SPAN, MAX_LOAD_SPAN, parseBbox } from "@/lib/flyers/streets"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// A first look at an area waits on OpenStreetMap (usually a few seconds).
export const maxDuration = 30

/**
 * Streets for the flyer map. ?bbox=south,west,north,east
 *   mode=all (default): every street in view, loading new areas from OpenStreetMap first (small views only)
 *   mode=covered: only streets that have been flyered (for zoomed-out views)
 */
export async function GET(request: Request) {
  await requireOwner()
  const search = new URL(request.url).searchParams
  const covered = search.get("mode") === "covered"
  const bbox = parseBbox(search.get("bbox"), covered ? MAX_COVERED_SPAN : MAX_LOAD_SPAN)
  if (!bbox) return NextResponse.json({ error: "Zoom in on Northeast Ohio to load streets." }, { status: 400 })

  const db = requireSupabaseAdmin()
  try {
    if (covered) return NextResponse.json({ streets: await coveredStreetsInView(db, bbox) })
    let warning: string | undefined
    try {
      await ensureStreets(db, bbox)
    } catch (e) {
      // Still show what's stored; the next pan retries the missing area.
      warning = e instanceof Error ? e.message : String(e)
      console.error("[flyer map] street load failed:", warning)
    }
    return NextResponse.json({ streets: await streetsInView(db, bbox), warning })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
