"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { errorMessage } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { requireOwner } from "@/lib/auth/session"
import { locate } from "@/lib/geo/locate"
import { getSettings, updateSettings } from "@/lib/ops/settings"
import { check } from "@/lib/ops/types"
import { START_SLOTS, withStart } from "@/lib/routes/starts"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

const StartKey = z.enum(["school", "home", "emmett"])

/** Save where a start point is. The address is looked up so the route can begin there. */
export async function saveRouteStart(key: string, address: string): Promise<ActionResult> {
  await requireOwner()
  try {
    const k = StartKey.parse(key)
    const label = START_SLOTS.find((s) => s.key === k)?.label ?? "Start"
    const a = address.trim().slice(0, 300)
    if (!a) return { ok: false, error: "Type the address." }
    const hit = await locate(a)
    if (!hit) return { ok: false, error: "Couldn't find that address. Include the street number, city and state (or ZIP)." }
    const db = requireSupabaseAdmin()
    const settings = await getSettings(db)
    await updateSettings(db, { route_starts: withStart((settings as { route_starts?: unknown }).route_starts, { key: k, address: a, ...hit }) })
    revalidatePath("/admin/map")
    return { ok: true, message: `${label} saved` }
  } catch (e) {
    const msg = errorMessage(e)
    return { ok: false, error: /route_starts/.test(msg) ? "Start points can't be saved yet: the route_starts database update hasn't been applied." : msg }
  }
}

/** How many addresses one press looks up (the free geocoder is slow; the button can be pressed again). */
const LOCATE_BATCH = 25

/** Look up houses that have an address but aren't on the map yet. */
export async function locateMissingHouses(): Promise<ActionResult> {
  await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const rows = (check(await db.from("customers").select("id,address").is("lat", null).not("address", "is", null).order("created_at", { ascending: false }).limit(LOCATE_BATCH), "map(missing)") ??
      []) as { id: string; address: string | null }[]
    const todo = rows.filter((r) => r.address?.trim())
    if (!todo.length) return { ok: true, message: "Nothing to look up" }
    let found = 0
    // Two at a time, like the other geocoder callers.
    for (let i = 0; i < todo.length; i += 2) {
      await Promise.all(
        todo.slice(i, i + 2).map(async (r) => {
          const hit = await locate(r.address as string)
          if (!hit) return
          check(await db.from("customers").update(hit).eq("id", r.id), "map(locate save)")
          found += 1
        }),
      )
    }
    revalidatePath("/admin/map")
    const left = todo.length - found
    return { ok: true, message: `Put ${found} house${found === 1 ? "" : "s"} on the map${left ? `. ${left} couldn't be found: check those addresses.` : ""}` }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
