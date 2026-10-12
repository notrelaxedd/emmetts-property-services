"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/auth/session"
import { check } from "@/lib/ops"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string }

function revalidate() {
  revalidatePath("/admin/fleet")
  revalidatePath("/admin", "layout")
}

/** Put a failed task back in the queue now, with a fresh set of attempts. */
export async function retryTask(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, reason: "Invalid task." }
  try {
    const db = requireSupabaseAdmin()
    const rows = check(
      await db
        .from("fleet_tasks")
        .update({ status: "queued", run_after: new Date().toISOString(), attempts: 0, finished_at: null, worker: null })
        .eq("id", id)
        .eq("status", "failed")
        .select("id"),
      "retry task",
    )
    revalidate()
    return rows?.length ? { ok: true, message: "Task queued again." } : { ok: false, reason: "Only failed tasks can be retried." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Requeue tasks stuck in `running` for over 10 minutes (the host worker also does this). */
export async function requeueStale(): Promise<ActionResult> {
  await requireOwner()
  try {
    const db = requireSupabaseAdmin()
    const n = Number(check(await db.rpc("requeue_stale_tasks", { p_stale: "10 minutes" }), "requeue stale") ?? 0)
    revalidate()
    return { ok: true, message: n ? `Requeued ${n} stale task${n === 1 ? "" : "s"}.` : "No stale tasks." }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
