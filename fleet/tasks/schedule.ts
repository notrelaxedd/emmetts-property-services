/**
 * `schedule` (role scheduler): gather a `SchedulerInput` from the database, run the pure
 * `lib/scheduler.solve`, and write its proposals (job → `proposed`, crew → `offered`).
 *
 * What a run looks at is durable state on the job rows, never the task payload (a de-duped task
 * would lose its ids):
 * - Jobs marked `resolve_reason` (see `markForResolve` in lib/ops/jobs.ts). A marked job that is on
 *   weather hold and still proposed / confirmed / booked is taken off its day (→ `unscheduled`, live
 *   assignments `dropped`, `weather_hold_date` remembered) and re-planned. Other marks (drop, decline,
 *   time off) keep the slot: the cover pass below fills the gap. Marks are cleared after the run.
 * - Every `unscheduled` job is solved (so the 15-minute sweep catches stragglers). A job still on
 *   weather hold keeps its held day closed (`closedDates`) until it is re-proposed, which also
 *   clears the hold.
 * - Jobs with a declined / dropped crew member and too few holding crew get a cover offer for the
 *   SAME slot (`findCover`); if nobody fits, the owner gets a `needs_cover` booking card.
 * - Jobs on `owner_hold` (owner rejected the slot or marked a card handled) are left alone.
 * - Informational cards are only raised again when their text changes (no fresh card every sweep
 *   for something the owner already saw).
 */
import type { AssignmentStatus, Customer, Job, JobAssignment } from "../../lib/db/types";
import { createApproval } from "../../lib/ops/approvals";
import type { CreateApprovalInput } from "../../lib/ops/approvals";
import { tryTransitionJob, withdrawBookingRequests } from "../../lib/ops/jobs";
import { getSettings } from "../../lib/ops/settings";
import { check } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import { findCover, HOLDING_ASSIGNMENT_STATUSES, localDate, solve } from "../../lib/scheduler";
import type { CustomerInfo, ExistingAssignment, SchedulerInput } from "../../lib/scheduler";
import type { TaskContext } from "../context";
import type { SchedulePayload } from "./schemas";

/** Rows that hold a crew member on a job. `swap_offered` rows are candidates and hold nobody. */
const HOLDING: readonly AssignmentStatus[] = HOLDING_ASSIGNMENT_STATUSES;
const GONE: AssignmentStatus[] = ["declined", "dropped"];
const SCHEDULED: Job["status"][] = ["proposed", "crew_confirmed", "booked", "in_progress"];
const RESETTABLE: Job["status"][] = ["proposed", "crew_confirmed", "booked"];
const OPEN: Job["status"][] = ["unscheduled", ...SCHEDULED];

export type ScheduleResult = {
  reason: string;
  /** Marked jobs picked up this run (owner-held ones excluded). */
  resolved: number;
  reset: number;
  considered: number;
  proposed: number;
  unschedulable: number;
  covers: number;
  no_cover: number;
};

/** Jobs carrying a `resolve_reason` mark that the scheduler may act on. */
export async function loadMarkedJobs(db: Db): Promise<Job[]> {
  const open = check(await db.from("jobs").select("*").in("status", OPEN), "schedule(marked)") ?? [];
  return open.filter((j) => j.resolve_reason !== null && j.resolve_reason !== undefined && !j.owner_hold);
}

/**
 * Take weather-held marked jobs off their day. Returns the ids that were reset and the days they
 * were on (closed for this run; later runs read `weather_hold_date`).
 */
export async function resetWeatherHeld(db: Db, marked: Job[], actor: string): Promise<{ reset: string[]; closedDates: string[] }> {
  const reset: string[] = [];
  const closed: string[] = [];
  for (const j of marked) {
    if (!j.weather_hold || !RESETTABLE.includes(j.status)) continue;
    const day = j.start_at ? localDate(new Date(j.start_at)) : j.weather_hold_date;
    const moved = await tryTransitionJob(db, j.id, "unscheduled", {
      actor,
      from: j.status,
      patch: { weather_hold_date: day ?? null, resolve_reason: null },
    });
    if (!moved) continue; // changed under us
    if (day && !closed.includes(day)) closed.push(day);
    check(
      await db.from("job_assignments").update({ status: "dropped" }).eq("job_id", j.id).in("status", HOLDING),
      "schedule(drop assignments)",
    );
    check(await db.from("job_assignments").delete().eq("job_id", j.id).eq("status", "swap_offered"), "schedule(drop swaps)");
    await withdrawBookingRequests(db, j.id, actor, "Withdrawn: the job was taken off its day for weather.");
    reset.push(j.id);
  }
  return { reset, closedDates: closed };
}

type Gathered = {
  input: SchedulerInput;
  /** Scheduled (not in the solve set) jobs and all their assignments, for the cover pass. */
  scheduledJobs: Job[];
  assignments: JobAssignment[];
  customers: Record<string, Customer>;
};

async function loadCustomers(db: Db, ids: string[]): Promise<{ rows: Record<string, Customer>; info: Record<string, CustomerInfo> }> {
  const rows: Record<string, Customer> = {};
  const info: Record<string, CustomerInfo> = {};
  if (!ids.length) return { rows, info };
  const customers = check(await db.from("customers").select("*").in("id", ids), "schedule(customers)") ?? [];
  const leads =
    check(await db.from("leads").select("*").in("customer_id", ids).order("created_at", { ascending: false }), "schedule(leads)") ?? [];
  for (const c of customers) {
    rows[c.id] = c;
    const latest = leads.find((l) => l.customer_id === c.id);
    info[c.id] = { lat: c.lat, lng: c.lng, name: c.name, preferred_days: latest?.preferred_days ?? [] };
  }
  return { rows, info };
}

function withTimes(assignments: JobAssignment[], jobs: Job[]): ExistingAssignment[] {
  const byId: Record<string, Job> = {};
  for (const j of jobs) byId[j.id] = j;
  const out: ExistingAssignment[] = [];
  for (const a of assignments) {
    const j = byId[a.job_id];
    if (!j || !j.start_at || !j.end_at || !HOLDING.includes(a.status)) continue;
    out.push({ ...a, start_at: j.start_at, end_at: j.end_at, est_minutes: j.est_minutes, customer_id: j.customer_id });
  }
  return out;
}

/**
 * Read everything `solve` needs. `closedDates` come from the reset step; days of jobs still on
 * weather hold (`weather_hold_date`, today or later) are added. Owner-held jobs are not solved.
 */
export async function gatherSchedulerInput(db: Db, now: Date, closedDates: string[] = []): Promise<Gathered> {
  const unscheduled = check(await db.from("jobs").select("*").eq("status", "unscheduled"), "schedule(unscheduled)") ?? [];
  const scheduledJobs = check(await db.from("jobs").select("*").in("status", SCHEDULED), "schedule(scheduled)") ?? [];
  const scheduledIds = scheduledJobs.map((j) => j.id);
  const assignments = scheduledIds.length
    ? check(await db.from("job_assignments").select("*").in("job_id", scheduledIds), "schedule(assignments)") ?? []
    : [];

  const crew = check(await db.from("profiles").select("*").eq("role", "crew"), "schedule(crew)") ?? [];
  const ownerWindows = check(await db.from("owner_windows").select("*"), "schedule(owner windows)") ?? [];
  const today = localDate(now);
  const ownerExceptions = (check(await db.from("owner_exceptions").select("*"), "schedule(owner exceptions)") ?? []).filter(
    (e) => e.date >= today,
  );
  const crewAvailability = check(await db.from("crew_availability").select("*"), "schedule(crew availability)") ?? [];
  const crewExceptions = (
    check(await db.from("crew_exceptions").select("*").eq("status", "approved"), "schedule(crew exceptions)") ?? []
  ).filter((e) => e.date_to >= today);

  const toSolve = unscheduled.filter((j) => !j.owner_hold);
  const closed = [...closedDates];
  for (const j of toSolve) {
    const day = j.weather_hold ? j.weather_hold_date?.slice(0, 10) : null;
    if (day && day >= today && !closed.includes(day)) closed.push(day);
  }

  const customerIds: string[] = [];
  for (const j of unscheduled.concat(scheduledJobs)) if (!customerIds.includes(j.customer_id)) customerIds.push(j.customer_id);
  const { rows, info } = await loadCustomers(db, customerIds);
  const settings = await getSettings(db);

  return {
    input: {
      jobs: toSolve,
      crew,
      ownerWindows,
      ownerExceptions,
      crewAvailability,
      crewExceptions,
      existingAssignments: withTimes(assignments, scheduledJobs),
      customers: info,
      settings: { drop_notice_hours: settings.drop_notice_hours },
      now,
      ...(closed.length ? { closedDates: closed.sort() } : {}),
    },
    scheduledJobs,
    assignments,
    customers: rows,
  };
}

/** Offer a job to a crew member, reusing the (job, crew) row if one exists (it is unique). */
export async function offerAssignment(db: Db, jobId: string, crewId: string): Promise<void> {
  const prev = check(
    await db.from("job_assignments").select("*").eq("job_id", jobId).eq("crew_id", crewId).maybeSingle(),
    "schedule(assignment lookup)",
  );
  const fields = { status: "offered" as const, responded_at: null, swap_to_crew_id: null };
  if (prev) check(await db.from("job_assignments").update(fields).eq("id", prev.id), "schedule(re-offer)");
  else check(await db.from("job_assignments").insert({ job_id: jobId, crew_id: crewId, ...fields }), "schedule(offer)");
}

/**
 * Raise (or refresh) one of the scheduler's informational booking cards (`unschedulable` /
 * `needs_cover`) unless the owner already saw the same thing: the latest card of that flag for
 * the job has the same summary (pending → left as is; decided → not raised again).
 * Returns true when a card was written.
 */
export async function raiseInfoCard(
  db: Db,
  flag: "unschedulable" | "needs_cover",
  input: Omit<CreateApprovalInput, "kind" | "ref_table">,
): Promise<boolean> {
  const prior =
    check(
      await db
        .from("approvals")
        .select("*")
        .eq("kind", "booking")
        .eq("ref_table", "jobs")
        .eq("ref_id", input.ref_id)
        .order("created_at", { ascending: false }),
      "schedule(prior cards)",
    ) ?? [];
  const last = prior.find((a) => a.payload?.[flag] === true);
  if (last && (last.summary ?? null) === (input.summary ?? null)) return false;
  await createApproval(db, { ...input, kind: "booking", ref_table: "jobs" });
  return true;
}

const nameOf = (customers: Record<string, Customer>, id: string) => customers[id]?.name ?? "a customer";

export async function runSchedule(ctx: TaskContext, payload: SchedulePayload): Promise<ScheduleResult> {
  const { db } = ctx;
  const now = ctx.now();
  // `payload.job_ids` is only a hint now: the marks on the job rows are the source of truth.
  const marked = await loadMarkedJobs(db);
  const { reset, closedDates } = await resetWeatherHeld(db, marked, ctx.worker);
  const g = await gatherSchedulerInput(db, now, closedDates);
  const out: ScheduleResult = {
    reason: payload.reason,
    resolved: marked.length,
    reset: reset.length,
    considered: g.input.jobs.length,
    proposed: 0,
    unschedulable: 0,
    covers: 0,
    no_cover: 0,
  };

  if (g.input.jobs.length) {
    const result = solve(g.input);
    for (const p of result.proposals) {
      const moved = await tryTransitionJob(db, p.job_id, "proposed", {
        actor: ctx.worker,
        from: "unscheduled",
        patch: {
          start_at: p.start_at,
          end_at: p.end_at,
          schedule_reason: p.reason,
          weather_hold: false,
          weather_hold_date: null,
          resolve_reason: null,
        },
      });
      if (!moved) continue;
      for (const crewId of p.crew_ids) await offerAssignment(db, p.job_id, crewId);
      out.proposed++;
    }
    for (const u of result.unschedulable) {
      const job = g.input.jobs.find((j) => j.id === u.job_id);
      const name = job ? nameOf(g.customers, job.customer_id) : "a job";
      await raiseInfoCard(db, "unschedulable", {
        ref_id: u.job_id,
        payload: { job_id: u.job_id, unschedulable: true, reason: u.reason },
        title: `Can't schedule ${name}`,
        summary: u.reason,
        created_by: ctx.worker,
      });
      out.unschedulable++;
    }
  }

  await coverPass(ctx, g, now, out);
  await clearMarks(db, marked, reset);
  return out;
}

/** Clear the marks this run acted on (guarded on the value read, so a newer mark survives). */
async function clearMarks(db: Db, marked: Job[], alreadyCleared: string[]): Promise<void> {
  const byReason = new Map<string, string[]>();
  for (const j of marked) {
    if (alreadyCleared.includes(j.id) || !j.resolve_reason) continue;
    byReason.set(j.resolve_reason, [...(byReason.get(j.resolve_reason) ?? []), j.id]);
  }
  for (const [reason, ids] of Array.from(byReason)) {
    check(
      await db.from("jobs").update({ resolve_reason: null }).in("id", ids).eq("resolve_reason", reason),
      "schedule(clear marks)",
    );
  }
}

/** Find replacements (same slot) for declined / dropped crew on jobs that are short-handed. */
async function coverPass(ctx: TaskContext, g: Gathered, now: Date, out: ScheduleResult): Promise<void> {
  const { db } = ctx;
  // Re-read: proposals from this run are now scheduled jobs with offers.
  const jobs = (check(await db.from("jobs").select("*").in("status", RESETTABLE), "cover(jobs)") ?? []).filter(
    (j) => j.start_at && j.end_at && Date.parse(j.start_at) > now.getTime() && !j.owner_hold,
  );
  if (!jobs.length) return;
  const scheduledAll = check(await db.from("jobs").select("*").in("status", SCHEDULED), "cover(all scheduled)") ?? [];
  const allAssignments = scheduledAll.length
    ? check(await db.from("job_assignments").select("*").in("job_id", scheduledAll.map((j) => j.id)), "cover(assignments)") ?? []
    : [];
  const existing = withTimes(allAssignments, scheduledAll);

  for (const job of jobs) {
    const mine = allAssignments.filter((a) => a.job_id === job.id);
    const gone = mine.filter((a) => GONE.includes(a.status));
    const holding = mine.filter((a) => HOLDING.includes(a.status));
    const missing = job.crew_size - holding.length;
    if (!gone.length || missing <= 0) continue;

    // Skip people who left / declined, and swap candidates (their row is unique per job).
    const exclude = [...gone, ...mine.filter((a) => a.status === "swap_offered")].map((a) => a.crew_id);
    let short = 0;
    for (let k = 0; k < missing; k++) {
      const cover = findCover({
        crew: g.input.crew,
        ownerWindows: g.input.ownerWindows,
        ownerExceptions: g.input.ownerExceptions,
        crewAvailability: g.input.crewAvailability,
        crewExceptions: g.input.crewExceptions,
        existingAssignments: existing,
        now,
        job,
        declinedCrewId: gone[0].crew_id,
        excludeCrewIds: exclude,
      });
      if (!cover) {
        short = missing - k;
        break;
      }
      await offerAssignment(db, job.id, cover.crew_id);
      exclude.push(cover.crew_id);
      existing.push({
        id: `pending-${job.id}-${cover.crew_id}`, created_at: now.toISOString(), updated_at: now.toISOString(), job_id: job.id,
        crew_id: cover.crew_id, status: "offered", responded_at: null, swap_to_crew_id: null, start_at: job.start_at as string,
        end_at: job.end_at as string, est_minutes: job.est_minutes, customer_id: job.customer_id,
      });
      out.covers++;
      ctx.log.info("cover offered", { job: job.id, crew: cover.crew_id, why: cover.reason });
    }
    if (short > 0) {
      const name = g.customers[job.customer_id]?.name ?? (await customerName(db, job.customer_id));
      await raiseInfoCard(db, "needs_cover", {
        ref_id: job.id,
        payload: { job_id: job.id, needs_cover: true, missing: short, declined_crew_ids: gone.map((a) => a.crew_id) },
        title: `No cover for ${name}`,
        summary: `${short} of ${job.crew_size} crew still needed and nobody else is free for that slot. Move the job or find someone.`,
        created_by: ctx.worker,
      });
      out.no_cover++;
    }
  }
}

async function customerName(db: Db, id: string): Promise<string> {
  const c = check(await db.from("customers").select("*").eq("id", id).maybeSingle(), "cover(customer)");
  return c?.name ?? "a customer";
}
