import type { AssignmentStatus, CrewException, Job, JobAssignment, JobStatus, QuoteItem } from "../db/types";
import { HOLDING_ASSIGNMENT_STATUSES } from "../scheduler/capacity";
import { addDays, zonedToUtc } from "../scheduler/time";
import { decideApproval } from "./approvals";
import { enqueueSchedule } from "./tasks";
import { check, one } from "./types";
import type { Db } from "./types";

/** Billed quote items: `auto` / `priced` with a price (declined, referred and unpriced custom items are ignored). */
export async function billedItemsForQuote(db: Db, quoteId: string): Promise<QuoteItem[]> {
  const items = check(
    await db.from("quote_items").select("*").eq("quote_id", quoteId).in("status", ["auto", "priced"]),
    "billedItemsForQuote",
  );
  return (items ?? []).filter((i) => i.price !== null && i.price !== undefined).sort((a, b) => a.sort_order - b.sort_order);
}

/** What the job will take, from the billed items: minutes = sum of est_hours × 60; crew = the biggest line's crew. */
export function estimateFromItems(items: Pick<QuoteItem, "est_hours" | "crew_size">[]): { est_minutes: number; crew_size: number } {
  return {
    est_minutes: Math.round(items.reduce((sum, i) => sum + i.est_hours * 60, 0)),
    crew_size: Math.max(1, ...items.map((i) => i.crew_size)),
  };
}

/** Calendar length for an estimate: the same 30-minute floor a job gets when it's dragged onto the calendar. */
export function slotMinutes(estMinutes: number): number {
  return Math.max(30, estMinutes);
}

/** Jobs whose length still follows their quote: not yet started, finished or cancelled. */
const RESIZABLE: JobStatus[] = ["unscheduled", "proposed", "crew_confirmed", "booked"];

/** Service names on a job (its quote's billed lines), in display order. Empty for a job without a quote. */
export async function servicesForJob(db: Db, job: Pick<Job, "quote_id">): Promise<string[]> {
  if (!job.quote_id) return [];
  return (await billedItemsForQuote(db, job.quote_id)).map((i) => i.description);
}

/**
 * The job for a freshly estimated quote: created `unscheduled` and UNPAID as soon as the quote has a
 * billed line, so it shows on the "Needs a day" rail of /admin/schedule and the owner can drag it onto
 * the calendar. Payment is collected after the job (see lib/ops/payments.ts and the Stripe webhook).
 * Idempotent per quote. The job's estimate follows the quote (the owner may price a custom line or
 * change the hours later): on the rail only `est_minutes` / `crew_size` change; on the calendar the
 * slot keeps its start and its end moves to fit. Started, done and cancelled jobs are left alone.
 * Returns null (and creates nothing) when the quote has no billed line yet.
 */
export async function ensureJobForQuote(db: Db, quoteId: string): Promise<Job | null> {
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "ensureJobForQuote(quote)");
  if (!quote) throw new Error(`ensureJobForQuote: quote ${quoteId} not found`);
  const billed = await billedItemsForQuote(db, quoteId);
  const existing = check(
    await db.from("jobs").select("*").eq("quote_id", quoteId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "ensureJobForQuote(existing)",
  );
  if (billed.length === 0) return existing;
  const estimate = estimateFromItems(billed);
  if (existing) {
    if (!RESIZABLE.includes(existing.status)) return existing;
    if (existing.est_minutes === estimate.est_minutes && existing.crew_size === estimate.crew_size) return existing;
    const patch: Partial<Job> = { ...estimate };
    const onCalendar = existing.status !== "unscheduled" && existing.start_at;
    if (onCalendar && existing.est_minutes !== estimate.est_minutes && estimate.est_minutes > 0) {
      patch.end_at = new Date(Date.parse(onCalendar) + slotMinutes(estimate.est_minutes) * 60_000).toISOString();
    }
    return one(await db.from("jobs").update(patch).eq("id", existing.id).select("*").single(), "ensureJobForQuote(refresh)");
  }
  const inserted = await db
    .from("jobs")
    .insert({
      quote_id: quoteId,
      customer_id: quote.customer_id,
      status: "unscheduled",
      start_at: null,
      end_at: null,
      ...estimate,
      paid: false,
      paid_at: null,
      weather_hold: false,
      deadline: null,
      completion_photo_paths: [],
    })
    .select("*")
    .single();
  if (inserted.error && (inserted.error as { code?: string }).code === "23505") {
    return one(await db.from("jobs").select("*").eq("quote_id", quoteId).limit(1).maybeSingle(), "ensureJobForQuote(after conflict)");
  }
  return one(inserted, "ensureJobForQuote(insert)");
}

/**
 * The quote was PAID (Stripe webhook, or cash / check recorded by the owner): the job is marked paid.
 * Normally the job already exists (created at estimate time, booked by phone, done); when a payment
 * lands first (an old pay link, a customer paying up front) the job is created `unscheduled` and the
 * scheduler is asked to look at it. Idempotent per quote: a webhook retry changes nothing.
 */
export async function createJobFromQuote(db: Db, quoteId: string): Promise<Job> {
  const now = new Date().toISOString();
  const existing = check(
    await db.from("jobs").select("*").eq("quote_id", quoteId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "createJobFromQuote(existing)",
  );
  if (existing) {
    const job = existing.paid
      ? existing
      : one(await db.from("jobs").update({ paid: true, paid_at: now }).eq("id", existing.id).select("*").single(), "createJobFromQuote(mark paid)");
    // Retry-safe: the enqueue is de-duped, and covers a crash between insert and enqueue.
    if (job.status === "unscheduled") await enqueueSchedule(db, "job_paid", [job.id]);
    return job;
  }

  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "createJobFromQuote(quote)");
  if (!quote) throw new Error(`createJobFromQuote: quote ${quoteId} not found`);
  const billed = await billedItemsForQuote(db, quoteId);
  if (billed.length === 0) throw new Error(`createJobFromQuote: quote ${quoteId} has no priced items`);

  const inserted = await db
    .from("jobs")
    .insert({
      quote_id: quoteId,
      customer_id: quote.customer_id,
      status: "unscheduled",
      start_at: null,
      end_at: null,
      ...estimateFromItems(billed),
      paid: true,
      paid_at: now,
      weather_hold: false,
      deadline: null,
      completion_photo_paths: [],
    })
    .select("*")
    .single();
  if (inserted.error && (inserted.error as { code?: string }).code === "23505") {
    // Lost a race with a concurrent call (unique index jobs_quote_id_key): use the winner's job.
    const winner = one(
      await db.from("jobs").select("*").eq("quote_id", quoteId).limit(1).maybeSingle(),
      "createJobFromQuote(after conflict)",
    );
    return winner;
  }
  const job = one(inserted, "createJobFromQuote(insert)");
  await enqueueSchedule(db, "job_paid", [job.id]);
  return job;
}

/**
 * Allowed job status moves. `done` and `cancelled` are terminal. Every edge has a caller:
 *  - unscheduled → proposed ........ the owner drags the job onto the calendar (`scheduleJobAt`), or
 *                                    the scheduler places it (when `settings.auto_schedule` is on)
 *  - proposed → crew_confirmed ..... enough crew said they are available (`maybeConfirmJob`)
 *  - proposed / crew_confirmed → unscheduled ... owner takes it back off the calendar (`rejectBooking`,
 *                                    `unplaceJob`), or a weather hold resets it for re-planning (scheduler)
 *  - proposed / crew_confirmed → booked ... owner confirmed the day with the customer by phone (`bookJob`)
 *  - crew_confirmed → proposed ..... a crew member left (drop / time off) or the owner moved it:
 *                                    the new crew has to accept before it is re-confirmed
 *  - booked → proposed ............. owner moved it on the schedule (crew are re-asked)
 *  - booked → unscheduled .......... weather hold reset (scheduler)
 *  - booked → in_progress → done ... crew start / complete
 *  - any live state → cancelled .... owner cancels
 */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  unscheduled: ["proposed", "cancelled"],
  proposed: ["crew_confirmed", "booked", "unscheduled", "cancelled"],
  crew_confirmed: ["booked", "proposed", "unscheduled", "cancelled"],
  booked: ["in_progress", "proposed", "unscheduled", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export type TransitionOptions = {
  actor: string;
  /** Only move when the job is currently in one of these statuses (else `tryTransitionJob` returns null). */
  from?: JobStatus | readonly JobStatus[];
  /** Extra columns written in the same guarded update (e.g. the new slot). Applied after the defaults. */
  patch?: Partial<Job>;
};

/**
 * Moves a job to `to` with a guarded update (`where status = <current>`). Throws on a missing job or
 * an illegal move; returns null when the job is not in `opts.from` or changed concurrently.
 */
export async function tryTransitionJob(db: Db, jobId: string, to: JobStatus, opts: TransitionOptions): Promise<Job | null> {
  const job = check(await db.from("jobs").select("*").eq("id", jobId).maybeSingle(), "transitionJob(lookup)");
  if (!job) throw new Error(`transitionJob: job ${jobId} not found`);
  if (opts.from !== undefined) {
    const from: readonly JobStatus[] = typeof opts.from === "string" ? [opts.from] : opts.from;
    if (!from.includes(job.status)) return null;
  }
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
  Object.assign(patch, opts.patch ?? {}, { status: to });
  const rows = check(
    await db.from("jobs").update(patch).eq("id", jobId).eq("status", job.status).select("*"),
    "transitionJob(update)",
  );
  return rows?.[0] ?? null;
}

/** Moves a job to `to`, throwing on an illegal move or a concurrent change. Returns the updated row. */
export async function transitionJob(db: Db, jobId: string, to: JobStatus, opts: TransitionOptions): Promise<Job> {
  const out = await tryTransitionJob(db, jobId, to, opts);
  if (!out) throw new Error(`transitionJob: job ${jobId} changed while moving it to ${to} (by ${opts.actor}); try again`);
  return out;
}

// ---------- Re-solve marks (durable; read by fleet/tasks/schedule.ts) ----------

/**
 * Why the scheduler should re-look at a job on its next run (`jobs.resolve_reason`):
 *  - `drop` / `declined` / `crew_change`: a crew member left; keep the slot and find cover;
 *  - `weather_hold`: the job is held (`weather_hold = true`): take it off its day and re-plan it.
 */
export type ResolveReason = "drop" | "declined" | "crew_change" | "weather_hold";

/** Statuses a job can be re-solved from. */
const OPEN_JOB_STATUSES: JobStatus[] = ["unscheduled", "proposed", "crew_confirmed", "booked"];

const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

/** Durable mark: the scheduler picks the job up on its next run (sweep or event) and clears it. */
export async function markForResolve(db: Db, jobIds: string[], reason: ResolveReason): Promise<void> {
  const ids = unique(jobIds);
  if (!ids.length) return;
  check(
    await db.from("jobs").update({ resolve_reason: reason }).in("id", ids).in("status", OPEN_JOB_STATUSES),
    "markForResolve",
  );
}

/** `markForResolve` + ask the scheduler to run now (the mark survives a de-duped or failed enqueue). */
export async function requestResolve(db: Db, jobIds: string[], reason: ResolveReason, taskReason: string = reason): Promise<void> {
  await markForResolve(db, jobIds, reason);
  await enqueueSchedule(db, taskReason, unique(jobIds));
}

// ---------- Owner decisions the scheduler must respect ----------

/** Informational booking cards from the scheduler ("Can't schedule X", "No cover for X"). */
export function isInfoBookingPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return payload?.unschedulable === true || payload?.needs_cover === true;
}

/**
 * The "Call <customer> to confirm" card raised when a job goes on the calendar (lib/ops/booking.ts).
 * It stays up while the job is on the calendar, whatever the crew answer: only booking, unplacing or
 * cancelling the job closes it.
 */
export function isCallToConfirmPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return payload?.call_to_confirm === true;
}

/**
 * `owner_hold = true`: the scheduler leaves the job alone (no proposal, reset or cover) until the
 * owner releases it. Releasing asks the scheduler to look at it again.
 */
export async function setOwnerHold(db: Db, jobId: string, hold: boolean): Promise<void> {
  check(await db.from("jobs").update({ owner_hold: hold }).eq("id", jobId), "setOwnerHold");
  if (!hold) await enqueueSchedule(db, "owner_released", [jobId]);
}

/**
 * Withdraws pending legacy "Book" cards for a job (its crew no longer stands). The scheduler's
 * informational cards and the "call to confirm" card are left alone. A card decided concurrently is skipped.
 */
export async function withdrawBookingRequests(db: Db, jobId: string, actor: string, note: string): Promise<number> {
  const pending =
    check(
      await db.from("approvals").select("*").eq("kind", "booking").eq("ref_table", "jobs").eq("ref_id", jobId).eq("status", "pending"),
      "withdrawBookingRequests",
    ) ?? [];
  let n = 0;
  for (const a of pending) {
    if (isInfoBookingPayload(a.payload) || isCallToConfirmPayload(a.payload)) continue;
    try {
      await decideApproval(db, a.id, "rejected", { decidedBy: actor, note });
      n++;
    } catch (e) {
      console.warn(`[jobs] could not withdraw booking approval ${a.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

// ---------- Weather holds ----------

/** Put jobs on weather hold and ask the scheduler to take them off their day and re-plan them. */
export async function holdForWeather(db: Db, jobIds: string[]): Promise<string[]> {
  const ids = unique(jobIds);
  if (!ids.length) return [];
  const held =
    check(
      await db.from("jobs").update({ weather_hold: true }).in("id", ids).in("status", OPEN_JOB_STATUSES).select("id"),
      "holdForWeather",
    ) ?? [];
  const heldIds = held.map((r) => r.id);
  await requestResolve(db, heldIds, "weather_hold");
  return heldIds;
}

/** Clear a weather hold (and its closed day / pending re-plan). */
export async function clearWeatherHold(db: Db, jobId: string): Promise<void> {
  check(await db.from("jobs").update({ weather_hold: false, weather_hold_date: null }).eq("id", jobId), "clearWeatherHold");
  check(
    await db.from("jobs").update({ resolve_reason: null }).eq("id", jobId).eq("resolve_reason", "weather_hold"),
    "clearWeatherHold(mark)",
  );
  await enqueueSchedule(db, "weather_hold_cleared");
}

// ---------- Crew leaving a job (drop, approved time off) ----------

/**
 * A crew member leaves a job that keeps its slot and its other crew: their holding rows become
 * `dropped` and any swap they had out for it is withdrawn. A `crew_confirmed` job goes back to
 * `proposed` (its pending "Book" card is withdrawn), so the replacement's acceptance re-confirms it
 * and the owner books it again. A `booked` job stays `booked`: the customer was already confirmed,
 * cover just fills the gap (no new booking approval). Returns true when a row was dropped.
 */
export async function releaseCrewFromJob(
  db: Db,
  jobId: string,
  crewId: string,
  opts: { actor: string; from?: readonly AssignmentStatus[]; now?: Date },
): Promise<boolean> {
  const at = (opts.now ?? new Date()).toISOString();
  const dropped =
    check(
      await db
        .from("job_assignments")
        .update({ status: "dropped", responded_at: at })
        .eq("job_id", jobId)
        .eq("crew_id", crewId)
        .in("status", opts.from ?? HOLDING_ASSIGNMENT_STATUSES)
        .select("id"),
      "releaseCrewFromJob(drop)",
    ) ?? [];
  // Swap offers they had out for this job (rows owned by the candidates).
  check(
    await db.from("job_assignments").delete().eq("job_id", jobId).eq("swap_to_crew_id", crewId).eq("status", "swap_offered"),
    "releaseCrewFromJob(swaps)",
  );
  if (!dropped.length) return false;

  const reconfirmed = await tryTransitionJob(db, jobId, "proposed", { actor: opts.actor, from: "crew_confirmed" });
  if (reconfirmed) {
    await withdrawBookingRequests(db, jobId, opts.actor, "Withdrawn: a crew member left the job, so it needs re-confirming.");
  }
  return true;
}

/**
 * Crew drop (outside the notice window, or an approved drop request): keep the slot and the other
 * crew, mark the job `resolve_reason = 'drop'` and let the scheduler's cover pass find a replacement.
 */
export async function dropAssignmentKeepSlot(
  db: Db,
  assignment: Pick<JobAssignment, "job_id" | "crew_id">,
  opts: { actor: string; from?: readonly AssignmentStatus[]; taskReason?: string },
): Promise<boolean> {
  const changed = await releaseCrewFromJob(db, assignment.job_id, assignment.crew_id, opts);
  await requestResolve(db, [assignment.job_id], "drop", opts.taskReason ?? "drop");
  return changed;
}

type DateRange = Pick<CrewException, "date_from" | "date_to" | "start_time" | "end_time">;

/** A time-off range as [start, end) epoch-ms intervals, one per local day (whole days without times). */
export function exceptionIntervals(e: DateRange): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let d = e.date_from; d <= e.date_to; d = addDays(d, 1)) {
    const start = zonedToUtc(d, e.start_time ?? "00:00").getTime();
    const end = e.end_time ? zonedToUtc(d, e.end_time).getTime() : zonedToUtc(addDays(d, 1), "00:00").getTime();
    out.push({ start, end });
  }
  return out;
}

/**
 * Approved time off: the crew member comes off every proposed / confirmed / booked job that overlaps
 * it (holding rows → `dropped`, swap offers to or from them withdrawn), and those jobs are marked
 * `crew_change` so the scheduler's cover pass finds replacements for the same slot. Returns the ids.
 */
export async function dropCrewFromOverlappingJobs(
  db: Db,
  crewId: string,
  dateFrom: string,
  dateTo: string,
  startTime?: string | null,
  endTime?: string | null,
  opts: { actor: string } = { actor: "time-off" },
): Promise<string[]> {
  const intervals = exceptionIntervals({ date_from: dateFrom, date_to: dateTo, start_time: startTime ?? null, end_time: endTime ?? null });
  const rows =
    check(
      await db.from("job_assignments").select("*").eq("crew_id", crewId).in("status", [...HOLDING_ASSIGNMENT_STATUSES, "swap_offered"]),
      "dropCrewFromOverlappingJobs(assignments)",
    ) ?? [];
  if (!rows.length) return [];
  const jobs =
    check(
      await db
        .from("jobs")
        .select("*")
        .in("id", unique(rows.map((r) => r.job_id)))
        .in("status", ["proposed", "crew_confirmed", "booked"]),
      "dropCrewFromOverlappingJobs(jobs)",
    ) ?? [];
  const hit = jobs.filter((j) => {
    if (!j.start_at || !j.end_at) return false;
    const s = Date.parse(j.start_at);
    const e = Date.parse(j.end_at);
    return intervals.some((iv) => s < iv.end && e > iv.start);
  });

  const released: string[] = [];
  for (const j of hit) {
    // As a swap candidate they simply can't take it any more.
    check(
      await db.from("job_assignments").delete().eq("job_id", j.id).eq("crew_id", crewId).eq("status", "swap_offered"),
      "dropCrewFromOverlappingJobs(candidate swap)",
    );
    if (await releaseCrewFromJob(db, j.id, crewId, opts)) released.push(j.id);
  }
  await markForResolve(db, released, "crew_change");
  return released;
}

/**
 * Side effect of an approved crew exception. Time off frees the crew member from overlapping jobs
 * (see `dropCrewFromOverlappingJobs`); either kind asks the scheduler to re-solve.
 */
export async function applyApprovedCrewException(
  db: Db,
  exception: DateRange & Pick<CrewException, "crew_id" | "kind">,
  opts: { actor: string },
): Promise<string[]> {
  if (exception.kind !== "off") {
    await enqueueSchedule(db, "crew_extra_availability");
    return [];
  }
  const ids = await dropCrewFromOverlappingJobs(
    db, exception.crew_id, exception.date_from, exception.date_to, exception.start_time, exception.end_time, opts,
  );
  await enqueueSchedule(db, "crew_change", ids);
  return ids;
}
