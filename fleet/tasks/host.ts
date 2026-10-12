/**
 * Host role: no claiming. Every minute it keeps the fleet honest and acts as the cron:
 *  - requeue_stale_tasks('10 minutes')
 *  - workers silent for > 3 min → current_task = null, last_error = 'no heartbeat'
 *  - weather_watch every 6 h            (dedupe `weather:<yyyy-mm-dd>-<0..3>`)
 *  - schedule sweep every 15 min        (dedupe via enqueueSchedule's 15-minute bucket)
 *  - followup_reminder for booked jobs starting in 20–28 h (dedupe `reminder:<job_id>`)
 *  - followup_review for jobs done 24–72 h ago (dedupe `review:<job_id>`)
 *  - quotes past expires_at → expired
 * Each step is independent: one failing does not stop the others.
 */
import { enqueueSchedule, enqueueTask } from "../../lib/ops/tasks";
import { check } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import type { TaskContext } from "../context";
import { OFFLINE_ERROR } from "../heartbeat";
import { errorMessage } from "../log";
import { HOUR_MS, MINUTE_MS, weatherDedupeKey } from "../time";

export const STALE_TASK_INTERVAL = "10 minutes";
export const OFFLINE_AFTER_MS = 3 * MINUTE_MS;
export { OFFLINE_ERROR };
export const REMINDER_WINDOW_HOURS = { from: 20, to: 28 } as const;
export const REVIEW_WINDOW_HOURS = { from: 24, to: 72 } as const;

export async function requeueStale(db: Db): Promise<number> {
  return Number(check(await db.rpc("requeue_stale_tasks", { p_stale: STALE_TASK_INTERVAL }), "requeue_stale_tasks") ?? 0);
}

/** Mark silent workers offline (only rows that are not already marked). Returns their names. */
export async function markOfflineWorkers(db: Db, now: Date, self: string): Promise<string[]> {
  const cutoff = new Date(now.getTime() - OFFLINE_AFTER_MS).toISOString();
  const workers = check(await db.from("fleet_workers").select("*"), "fleet_workers") ?? [];
  const marked: string[] = [];
  for (const w of workers) {
    if (w.name === self) continue;
    const silent = !w.last_heartbeat || w.last_heartbeat < cutoff;
    if (!silent) continue;
    if (w.current_task === null && w.last_error === OFFLINE_ERROR) continue;
    check(
      await db.from("fleet_workers").update({ current_task: null, last_error: OFFLINE_ERROR }).eq("id", w.id),
      "fleet_workers(offline)",
    );
    marked.push(w.name);
  }
  return marked;
}

export async function enqueueWeatherWatch(db: Db, now: Date): Promise<string> {
  const key = weatherDedupeKey(now);
  return enqueueTask(db, { type: "weather_watch", payload: { slot: key }, dedupeKey: key });
}

/** Booked jobs starting 20–28 h from now get a reminder task (one per job, ever). */
export async function enqueueReminders(db: Db, now: Date): Promise<string[]> {
  const from = new Date(now.getTime() + REMINDER_WINDOW_HOURS.from * HOUR_MS).toISOString();
  const to = new Date(now.getTime() + REMINDER_WINDOW_HOURS.to * HOUR_MS).toISOString();
  const jobs =
    check(await db.from("jobs").select("*").eq("status", "booked").gte("start_at", from).lte("start_at", to), "host(reminder jobs)") ?? [];
  const ids: string[] = [];
  for (const j of jobs) {
    await enqueueTask(db, { type: "followup_reminder", payload: { job_id: j.id }, dedupeKey: `reminder:${j.id}` });
    ids.push(j.id);
  }
  return ids;
}

/** Jobs finished 24–72 h ago get a review-request task (one per job, ever). */
export async function enqueueReviews(db: Db, now: Date): Promise<string[]> {
  const from = new Date(now.getTime() - REVIEW_WINDOW_HOURS.to * HOUR_MS).toISOString();
  const to = new Date(now.getTime() - REVIEW_WINDOW_HOURS.from * HOUR_MS).toISOString();
  const jobs =
    check(await db.from("jobs").select("*").eq("status", "done").gte("completed_at", from).lte("completed_at", to), "host(review jobs)") ?? [];
  const ids: string[] = [];
  for (const j of jobs) {
    await enqueueTask(db, { type: "followup_review", payload: { job_id: j.id }, dedupeKey: `review:${j.id}` });
    ids.push(j.id);
  }
  return ids;
}

export async function expireQuotes(db: Db, now: Date): Promise<number> {
  const rows =
    check(
      await db.from("quotes").update({ status: "expired" }).eq("status", "sent").lt("expires_at", now.toISOString()).select("id"),
      "host(expire quotes)",
    ) ?? [];
  return rows.length;
}

export type HostTickResult = { ok: Record<string, unknown>; errors: string[] };

/** One host pass. Never throws; failures are collected in `errors` (and land in last_error). */
export async function hostTick(ctx: TaskContext): Promise<HostTickResult> {
  const { db } = ctx;
  const now = ctx.now();
  const ok: Record<string, unknown> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      ok[name] = await fn();
    } catch (e) {
      errors.push(`${name}: ${errorMessage(e)}`);
    }
  };
  await step("requeued", () => requeueStale(db));
  await step("offline", () => markOfflineWorkers(db, now, ctx.worker));
  await step("weather", () => enqueueWeatherWatch(db, now));
  await step("schedule", () => enqueueSchedule(db, "sweep", undefined, now));
  await step("reminders", () => enqueueReminders(db, now));
  await step("reviews", () => enqueueReviews(db, now));
  await step("expired", () => expireQuotes(db, now));
  return { ok, errors };
}
