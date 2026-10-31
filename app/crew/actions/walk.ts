"use server"

import { z } from "zod"
import { loadWalk } from "@/lib/canvass/load"
import type { WalkResultView } from "@/lib/canvass/views"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"
import { crewContext, errorMessage, fail } from "./shared"

const coord = (min: number, max: number) => z.number().finite().min(min).max(max)

/**
 * Walk Mode: the next good doors (the owner's `walk_doors`) within ~800 m of where the crew member is standing, in
 * walking order. Service role like the other canvass actions; the result carries only what the crew card shows
 * (address, first name, pitch, price label, light, callback words): never score points, profit or labor cost.
 */
export async function startWalkAction(lat: number, lng: number): Promise<{ ok: true; walk: WalkResultView } | { ok: false; error: string }> {
  const parsed = z.object({ lat: coord(-90, 90), lng: coord(-180, 180) }).safeParse({ lat, lng })
  if (!parsed.success) return fail("That location isn't valid.")
  const ctx = await crewContext()
  if (!ctx) return fail("Sign-in isn't configured.")
  try {
    const db = requireSupabaseAdmin()
    const walk = await loadWalk(db, { lat: parsed.data.lat, lng: parsed.data.lng })
    return { ok: true, walk }
  } catch (e) {
    return fail(errorMessage(e))
  }
}
