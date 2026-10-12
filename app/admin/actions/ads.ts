"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { actorOf, errorMessage } from "@/components/admin/inbox/server"
import type { ActionResult } from "@/components/admin/inbox/types"
import { requireOwner } from "@/lib/auth/session"
import { enqueueTask } from "@/lib/ops/tasks"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

/** Marks an approved ad as posted by hand (v1 doesn't auto-post). */
export async function markAdPosted(adId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("ads")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", z.string().uuid().parse(adId))
        .eq("status", "approved")
        .select("id"),
      "markAdPosted",
    )
    if (!rows?.length) return { ok: false, error: "Only approved ads can be marked posted." }
    revalidatePath("/admin/ads")
    return { ok: true, message: "Marked as posted" }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

const DraftAdSchema = z.object({
  channel: z.enum(["facebook", "instagram", "nextdoor"]),
  season: z.string().trim().min(1, "Pick a season").max(40),
  offer: z.string().trim().max(300),
})

/** Queues an `ad_draft` task for the ads worker; the draft comes back through the inbox. */
export async function draftNewAd(input: { channel: string; season: string; offer: string }): Promise<ActionResult> {
  const session = await requireOwner()
  try {
    const parsed = DraftAdSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") }
    const db = requireSupabaseAdmin()
    await enqueueTask(db, {
      type: "ad_draft",
      payload: { ...parsed.data, requested_by: actorOf(session) },
    })
    revalidatePath("/admin/ads")
    return { ok: true, message: "Queued. The draft will land in your inbox." }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
