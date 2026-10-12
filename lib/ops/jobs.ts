import type { Job, JobStatus } from "../db/types";
import { enqueueSchedule } from "./tasks";
import { check, one } from "./types";
import type { Db } from "./types";

/**
 * Creates the job for a paid quote and asks the scheduler to place it. Idempotent per quote:
 * a second call (Stripe webhook retry) returns the existing job and does not duplicate it.
 * `est_minutes` = sum of billed items' est_hours * 60; `crew_size` = largest item crew size.
 * Billed items are `auto` / `priced` items that have a price (declined, referred and unpriced
 * custom items are ignored).
 */
export async function createJobFromQuote(db: Db, quoteId: string): Promise<Job> {
  const existing = check(
    await db.from("jobs").select("*").eq("quote_id", quoteId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "createJobFromQuote(existing)",
  );
  if (existing) {
    // Retry-safe: the enqueue is de-duped, and covers a crash between insert and enqueue.
    if (existing.status === "unscheduled") await enqueueSchedule(db, "job_paid", [existing.id]);
    return existing;
  }

  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "createJobFromQuote(quote)");
  if (!quote) throw new Error(`createJobFromQuote: quote ${quoteId} not found`);

  const items = check(
    await db.from("quote_items").select("*").eq("quote_id", quoteId).in("status", ["auto", "priced"]),
    "createJobFromQuote(items)",
  );
  const billed = (items ?? []).filter((i) => i.price !== null && i.price !== undefined);
  if (billed.length === 0) throw new Error(`createJobFromQuote: quote ${quoteId} has no priced items`);

  const est_minutes = Math.round(billed.reduce((sum, i) => sum + i.est_hours * 60, 0));
  const crew_size = Math.max(1, ...billed.map((i) => i.crew_size));
  const now = new Date().toISOString();

  const job = one(
    await db
      .from("jobs")
      .insert({
        quote_id: quoteId,
        customer_id: quote.customer_id,
        status: "unscheduled",
        start_at: null,
        end_at: null,
        est_minutes,
        crew_size,
        paid: true,
        paid_at: now,
        weather_hold: false,
        deadline: null,
        completion_photo_paths: [],
      })
      .select("*")
      .single(),
    "createJobFromQuote(insert)",
  );
  await enqueueSchedule(db, "job_paid", [job.id]);
  return job;
}

/** Allowed job status moves. `done` and `cancelled` are terminal. */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  unscheduled: ["proposed", "cancelled"],
  proposed: ["crew_confirmed", "unscheduled", "cancelled"], // proposed -> unscheduled = re-solve
  crew_confirmed: ["booked", "unscheduled", "cancelled"], // crew_confirmed -> unscheduled = re-solve
  booked: ["in_progress", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Moves a job to `to`, throwing on an illegal move or a concurrent change. Returns the updated row. */
export async function transitionJob(db: Db, jobId: string, to: JobStatus, opts: { actor: string }): Promise<Job> {
  const job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "transitionJob(lookup)");
  if (!job) throw new Error(`transitionJob: job ${jobId} not found`);
  if (!canTransition(job.status, to)) {
    throw new Error(`transitionJob: illegal move ${job.status} -> ${to} for job ${jobId} (by ${opts.actor})`);
  }
  const now = new Date().toISOString();
  const patch: Partial<Job> = { status: to };
  if (to === "in_progress" && !job.started_at) patch.started_at = now;
  if (to === "done") patch.completed_at = now;
  if (to === "unscheduled") {
    patch.start_at = null;
    patch.end_at = null;
    patch.schedule_reason = null;
  }
  return one(
    await db.from("jobs").update(patch).eq("id", jobId).eq("status", job.status).select("*").single(),
    "transitionJob(update)",
  );
}
