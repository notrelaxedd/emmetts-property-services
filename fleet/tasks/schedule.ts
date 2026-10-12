/**
 * `schedule` (role scheduler): gather a `SchedulerInput` from the database, run the pure
 * `lib/scheduler.solve`, and write its proposals (job → `proposed`, crew → `offered`).
 *
 * - `job_ids` are re-solved: jobs that are `proposed` / `crew_confirmed` (or `booked` with a weather
 *   hold) are reset to `unscheduled` and their live assignments `dropped`. Booked jobs without a
 *   weather hold, and anything in progress / done / cancelled, are never touched.
 * - A weather-held job's current day is closed for this run (`closedDates`).
 * - Every other `unscheduled` job is swept in too (so the 15-minute sweep catches stragglers).
 * - Jobs with a declined / dropped crew member and too few active crew get a cover offer
 *   (`findCover`); if nobody fits, the owner gets a `booking` approval.
 */
import type { AssignmentStatus, Customer, Job, JobAssignment } from "../../lib/db/types";
import { createApproval } from "../../lib/ops/approvals";
import { getSettings } from "../../lib/ops/settings";
import { check } from "../../lib/ops/types";
import type { Db } from "../../lib/ops/types";
import { findCover, localDate, solve } from "../../lib/scheduler";
import type { CustomerInfo, ExistingAssignment, SchedulerInput } from "../../lib/scheduler";
import type { TaskContext } from "../context";
import type { SchedulePayload } from "./schemas";

const ACTIVE: AssignmentStatus[] = ["offered", "accepted", "swap_offered", "drop_requested"];
const GONE: AssignmentStatus[] = ["declined", "dropped"];
const SCHEDULED: Job["status"][] = ["proposed", "crew_confirmed", "booked", "in_progress"];

export type ScheduleResult = {
  reason: string;
  reset: number;
  considered: number;
  proposed: number;
  unschedulable: number;
  covers: number;
  no_cover: number;
};

/** Reset the re-solve set. Returns the ids that were reset and the weather-hold days to close. */
export async function resetJobs(db: Db, jobIds: string[]): Promise<{ reset: string[]; closedDates: string[] }> {
  const reset: string[] = [];
  const closed: string[] = [];
  if (!jobIds.length) return { reset, closedDates: closed };
  const jobs = check(await db.from("jobs").select("*").in("id", jobIds), "schedule(job_ids)") ?? [];
  for (const j of jobs) {
    const resettable = j.status === "proposed" || j.status === "crew_confirmed" || (j.status === "booked" && j.weather_hold);
    if (!resettable) continue;
    if (j.weather_hold && j.start_at) {
      const day = localDate(new Date(j.start_at));
      if (!closed.includes(day)) closed.push(day);
    }
    const moved = check(
      await db
        .from("jobs")
        .update({ status: "unscheduled", start_at: null, end_at: null, schedule_reason: null })
        .eq("id", j.id)
        .eq("status", j.status)
        .select("id"),
      "schedule(reset job)",
    );
    if (!moved?.length) continue; // changed under us
    check(
      await db.from("job_assignments").update({ status: "dropped" }).eq("job_id", j.id).in("status", ACTIVE),
      "schedule(drop assignments)",
    );
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
    if (!j || !j.start_at || !j.end_at || !ACTIVE.includes(a.status)) continue;
    out.push({ ...a, start_at: j.start_at, end_at: j.end_at, est_minutes: j.est_minutes, customer_id: j.customer_id });
  }
  return out;
}

/** Read everything `solve` needs. `closedDates` come from the reset step. */
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

  const customerIds: string[] = [];
  for (const j of unscheduled.concat(scheduledJobs)) if (!customerIds.includes(j.customer_id)) customerIds.push(j.customer_id);
  const { rows, info } = await loadCustomers(db, customerIds);
  const settings = await getSettings(db);

  return {
    input: {
      jobs: unscheduled,
      crew,
      ownerWindows,
      ownerExceptions,
      crewAvailability,
      crewExceptions,
      existingAssignments: withTimes(assignments, scheduledJobs),
      customers: info,
      settings: { drop_notice_hours: settings.drop_notice_hours },
      now,
      ...(closedDates.length ? { closedDates } : {}),
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

const nameOf = (customers: Record<string, Customer>, id: string) => customers[id]?.name ?? "a customer";

export async function runSchedule(ctx: TaskContext, payload: SchedulePayload): Promise<ScheduleResult> {
  const { db } = ctx;
  const now = ctx.now();
  const { reset, closedDates } = await resetJobs(db, payload.job_ids ?? []);
  const g = await gatherSchedulerInput(db, now, closedDates);
  const out: ScheduleResult = {
    reason: payload.reason, reset: reset.length, considered: g.input.jobs.length, proposed: 0, unschedulable: 0, covers: 0, no_cover: 0,
  };

  if (g.input.jobs.length) {
    const result = solve(g.input);
    for (const p of result.proposals) {
      const moved = check(
        await db
          .from("jobs")
          .update({ status: "proposed", start_at: p.start_at, end_at: p.end_at, schedule_reason: p.reason, weather_hold: false })
          .eq("id", p.job_id)
          .eq("status", "unscheduled")
          .select("id"),
        "schedule(propose)",
      );
      if (!moved?.length) continue;
      for (const crewId of p.crew_ids) await offerAssignment(db, p.job_id, crewId);
      out.proposed++;
    }
    for (const u of result.unschedulable) {
      const job = g.input.jobs.find((j) => j.id === u.job_id);
      const name = job ? nameOf(g.customers, job.customer_id) : "a job";
      await createApproval(db, {
        kind: "booking",
        ref_table: "jobs",
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
  return out;
}

/** Find replacements for declined / dropped crew on jobs that are short-handed. */
async function coverPass(ctx: TaskContext, g: Gathered, now: Date, out: ScheduleResult): Promise<void> {
  const { db } = ctx;
  // Re-read: proposals from this run are now scheduled jobs with offers.
  const jobs = (check(await db.from("jobs").select("*").in("status", ["proposed", "crew_confirmed", "booked"]), "cover(jobs)") ?? []).filter(
    (j) => j.start_at && j.end_at && Date.parse(j.start_at) > now.getTime(),
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
    const active = mine.filter((a) => ACTIVE.includes(a.status));
    const missing = job.crew_size - active.length;
    if (!gone.length || missing <= 0) continue;

    const exclude = gone.map((a) => a.crew_id);
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
      await createApproval(db, {
        kind: "booking",
        ref_table: "jobs",
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
