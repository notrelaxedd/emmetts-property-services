import type { Job, Settings } from "../db/types";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  buildCapacity,
  canTake,
  reserve,
  weekMinutes,
} from "./capacity";
import { milesBetween } from "./distance";
import {
  addDays,
  dateRange,
  formatDayLabel,
  formatDuration,
  formatTimeRange,
  localDate,
  weekdayOf,
  zonedToUtc,
} from "./time";
import type {
  Capacity,
  CoverResult,
  CrewCapacity,
  CustomerInfo,
  Interval,
  Proposal,
  SchedulerInput,
  SchedulerResult,
  Unschedulable,
} from "./types";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Never propose anything starting sooner than this after `now`. */
export const MIN_LEAD_MINUTES = 120;
/** Another job this close (miles) and this close in time (minutes, back to back) earns a bonus. */
export const NEARBY_MILES = 3;
export const ADJACENT_MINUTES = 60;
/** Under this distance the reason says "next door to". */
const NEXT_DOOR_MILES = 0.25;
/**
 * Tie-break rule: find the earliest feasible slot, then look only at feasible slots that start
 * within PREFERENCE_WINDOW_DAYS (7 × 24 h) of it. Among those, the highest score wins; equal
 * scores go to the earliest. Score = 2 for the customer's preferred weekday + 1 for being back to
 * back with a job within 3 miles. So a preferred day beats a nearby job, both beat neither, and a
 * preferred day never pushes a job out more than a week past its earliest opening.
 */
export const PREFERENCE_WINDOW_DAYS = 7;
const PREFERRED_DAY_POINTS = 2;
const NEARBY_POINTS = 1;

// ---------- Ordering ----------

function cmpNullableIso(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  return Date.parse(a) - Date.parse(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Order jobs by paid_at (nulls last), then deadline (nulls last), then created_at, then id. */
export function orderJobs<T extends Pick<Job, "id" | "paid_at" | "deadline" | "created_at">>(jobs: T[]): T[] {
  return [...jobs].sort(
    (a, b) =>
      cmpNullableIso(a.paid_at, b.paid_at) ||
      cmpNullableIso(deadlineIso(a.deadline), deadlineIso(b.deadline)) ||
      cmpNullableIso(a.created_at, b.created_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A deadline may be a date ("YYYY-MM-DD" = end of that local day) or a full timestamp. */
export function deadlineMs(deadline: string | null): number | null {
  if (!deadline) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return zonedToUtc(addDays(deadline, 1), "00:00").getTime();
  const t = Date.parse(deadline);
  return Number.isNaN(t) ? null : t;
}

function deadlineIso(deadline: string | null): string | null {
  const t = deadlineMs(deadline);
  return t == null ? null : new Date(t).toISOString();
}

// ---------- Notice window ----------

/** True when the job starts sooner than `drop_notice_hours` from now (drops need the owner's OK). */
export function isInsideNoticeWindow(
  job: Pick<Job, "start_at">,
  now: Date,
  settings: Pick<Settings, "drop_notice_hours">,
): boolean {
  if (!job.start_at) return false;
  return Date.parse(job.start_at) - now.getTime() < settings.drop_notice_hours * 60 * MINUTE;
}

// ---------- Helpers for reasons ----------

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function lastName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || null;
}

function joinNames(names: string[]): string {
  return names.join(" + ");
}

function totalMinutes(c: CrewCapacity): number {
  return Object.values(c.week_minutes).reduce((s, m) => s + m, 0);
}

/** Fairness: fewest hours that week, then fewest overall, then name, then id. */
function byFairness(at: number) {
  return (a: CrewCapacity, b: CrewCapacity) =>
    weekMinutes(a, at) - weekMinutes(b, at) ||
    totalMinutes(a) - totalMinutes(b) ||
    a.name.localeCompare(b.name) ||
    (a.crew_id < b.crew_id ? -1 : a.crew_id > b.crew_id ? 1 : 0);
}

function fairnessNote(chosen: CrewCapacity[], others: CrewCapacity[], at: number): string | null {
  if (!others.length) return null;
  const maxChosen = Math.max(...chosen.map((c) => weekMinutes(c, at)));
  const minOther = Math.min(...others.map((c) => weekMinutes(c, at)));
  if (maxChosen < minOther) {
    if (chosen.length === 1) return `${firstName(chosen[0].name)} has the fewest hours this week`;
    return `${joinNames(chosen.map((c) => firstName(c.name)))} have the fewest hours this week`;
  }
  return "hours are even this week";
}

type Placed = { job_id: string; customer_id: string | null; start: number; end: number };

type Nearby = { placed: Placed; miles: number };

function findNearby(
  slot: Interval,
  customerId: string,
  placed: Placed[],
  customers: Record<string, CustomerInfo>,
): Nearby | null {
  const here = customers[customerId];
  let best: Nearby | null = null;
  for (const p of placed) {
    if (!p.customer_id) continue;
    const gap = Math.max(p.start - slot.end, slot.start - p.end);
    if (gap < 0 || gap > ADJACENT_MINUTES * MINUTE) continue;
    const miles = milesBetween(here, customers[p.customer_id]);
    if (miles == null || miles > NEARBY_MILES) continue;
    if (!best || miles < best.miles) best = { placed: p, miles };
  }
  return best;
}

function nearbyNote(n: Nearby, customers: Record<string, CustomerInfo>): string {
  const who = lastName(customers[n.placed.customer_id ?? ""]?.name);
  const target = who ? `the ${who} job` : "another job";
  return n.miles < NEXT_DOOR_MILES ? `next door to ${target}` : `${n.miles.toFixed(1)} mi from ${target}, back to back`;
}

function slotLabel(start: number, end: number): string {
  return `${formatDayLabel(new Date(start))} ${formatTimeRange(new Date(start), new Date(end))}`;
}

// ---------- Solve ----------

type Feasible = { start: number; end: number; eligible: CrewCapacity[] };

/**
 * Greedy, explainable scheduler. Jobs are placed one at a time (see `orderJobs`); each placement
 * reserves its crew so later jobs see the reduced capacity. Pure: no I/O, no clock reads.
 */
export function solve(input: SchedulerInput): SchedulerResult {
  const horizonDays = input.horizonDays ?? 21;
  const stepMs = Math.max(1, input.slotStepMinutes ?? 30) * MINUTE;
  const jobIds = new Set(input.jobs.map((j) => j.id));
  const cap = buildCapacity({ ...input, horizonDays, ignoreJobIds: jobIds });
  const earliest = input.now.getTime() + MIN_LEAD_MINUTES * MINUTE;

  // Already-scheduled jobs (for the proximity bonus), one entry per job.
  const placed: Placed[] = [];
  const seen = new Set<string>();
  for (const a of input.existingAssignments) {
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(a.status) || jobIds.has(a.job_id) || seen.has(a.job_id)) continue;
    seen.add(a.job_id);
    placed.push({ job_id: a.job_id, customer_id: a.customer_id ?? null, start: Date.parse(a.start_at), end: Date.parse(a.end_at) });
  }

  const proposals: Proposal[] = [];
  const unschedulable: Unschedulable[] = [];
  const takingNew = Object.values(cap.crew).filter((c) => !c.paused).length;

  for (const job of orderJobs(input.jobs)) {
    if (!(job.est_minutes > 0)) {
      unschedulable.push({ job_id: job.id, reason: "No duration set (est_minutes is 0)." });
      continue;
    }
    const crewSize = Math.max(1, job.crew_size);
    if (crewSize > takingNew) {
      unschedulable.push({
        job_id: job.id,
        reason: `Needs ${crewSize} crew but only ${takingNew} can take new jobs.`,
      });
      continue;
    }

    const dur = job.est_minutes * MINUTE;
    const { feasible, hourCapped } = scanSlots(cap, earliest, stepMs, dur, job.est_minutes, crewSize);
    if (!feasible.length) {
      unschedulable.push({ job_id: job.id, reason: noSlotReason(cap, horizonDays, job.est_minutes, crewSize, hourCapped) });
      continue;
    }

    const due = deadlineMs(job.deadline);
    const onTime = due == null ? feasible : feasible.filter((f) => f.end <= due);
    const pool0 = onTime.length ? onTime : feasible;
    const late = due != null && !onTime.length;

    const customer = input.customers[job.customer_id];
    const preferred = new Set(customer?.preferred_days ?? []);
    const windowEnd = pool0[0].start + PREFERENCE_WINDOW_DAYS * DAY;
    let best: { f: Feasible; score: number; pref: boolean; near: Nearby | null } | null = null;
    for (const f of pool0) {
      if (f.start >= windowEnd) break;
      const pref = preferred.has(weekdayOf(localDate(new Date(f.start))));
      const near = findNearby(f, job.customer_id, placed, input.customers);
      const score = (pref ? PREFERRED_DAY_POINTS : 0) + (near ? NEARBY_POINTS : 0);
      if (!best || score > best.score) best = { f, score, pref, near };
    }
    const pick = best!;

    const ranked = [...pick.f.eligible].sort(byFairness(pick.f.start));
    const chosen = ranked.slice(0, crewSize);
    const others = ranked.slice(crewSize);

    const notes: string[] = [];
    if (late) notes.push("after the deadline (nothing open before it)");
    if (pick.pref) notes.push("preferred day");
    else if (preferred.size) notes.push("no preferred day open within a week");
    if (pick.near) notes.push(nearbyNote(pick.near, input.customers));
    if (!pick.pref && !pick.near) notes.push("earliest open slot");
    const fair = fairnessNote(chosen, others, pick.f.start);
    if (fair) notes.push(fair);

    const iv = { start: pick.f.start, end: pick.f.end };
    for (const c of chosen) reserve(cap, c.crew_id, iv, job.est_minutes);
    placed.push({ job_id: job.id, customer_id: job.customer_id, start: iv.start, end: iv.end });

    const body = notes.join("; ");
    proposals.push({
      job_id: job.id,
      start_at: new Date(iv.start).toISOString(),
      end_at: new Date(iv.end).toISOString(),
      crew_ids: chosen.map((c) => c.crew_id),
      reason: `${slotLabel(iv.start, iv.end)}, ${joinNames(chosen.map((c) => firstName(c.name)))}. ${body.charAt(0).toUpperCase()}${body.slice(1)}.`,
    });
  }

  return { proposals, unschedulable };
}

function scanSlots(
  cap: Capacity,
  earliest: number,
  stepMs: number,
  dur: number,
  minutes: number,
  crewSize: number,
): { feasible: Feasible[]; hourCapped: boolean } {
  const crew = Object.values(cap.crew);
  const feasible: Feasible[] = [];
  let hourCapped = false;
  for (const iv of cap.owner_open) {
    if (iv.end - dur < earliest) continue;
    // Slots sit on a grid anchored at the window's opening time.
    let s = iv.start;
    if (s < earliest) s = iv.start + Math.ceil((earliest - iv.start) / stepMs) * stepMs;
    for (; s + dur <= iv.end; s += stepMs) {
      const e = s + dur;
      const eligible: CrewCapacity[] = [];
      let capped = 0;
      for (const c of crew) {
        const r = canTake(c, s, e, minutes);
        if (r.ok) eligible.push(c);
        else if (r.why === "hours") capped++;
      }
      if (eligible.length >= crewSize) feasible.push({ start: s, end: e, eligible });
      else if (eligible.length + capped >= crewSize) hourCapped = true;
    }
  }
  return { feasible, hourCapped };
}

function noSlotReason(cap: Capacity, horizonDays: number, minutes: number, crewSize: number, hourCapped: boolean): string {
  if (!cap.owner_open.length) return `No open hours in the next ${horizonDays} days.`;
  if (hourCapped) {
    return `No slot in the next ${horizonDays} days: the crew who are free are at their weekly hour caps.`;
  }
  const who = crewSize === 1 ? "a crew member is" : `${crewSize} crew are`;
  return `No ${formatDuration(minutes)} slot in the next ${horizonDays} days where ${who} free inside open hours.`;
}

// ---------- Cover ----------

export type FindCoverInput = Pick<
  SchedulerInput,
  "crew" | "ownerWindows" | "ownerExceptions" | "crewAvailability" | "crewExceptions" | "existingAssignments" | "now"
> & {
  /** The already-scheduled job (start_at/end_at set). */
  job: Pick<Job, "id" | "start_at" | "end_at" | "est_minutes">;
  declinedCrewId: string;
  /** Anyone else to skip (e.g. people who already declined this job). */
  excludeCrewIds?: string[];
};

/**
 * Find one replacement crew member for the same time window of an already-scheduled job.
 * The slot was already agreed, so owner windows are not re-checked; the replacement must be
 * available, not paused, not busy, not already on the job, and under their weekly hour cap.
 * Returns the fairest pick (fewest hours that week) or null.
 */
export function findCover(input: FindCoverInput): CoverResult | null {
  const { job } = input;
  if (!job.start_at || !job.end_at) return null;
  const start = Date.parse(job.start_at);
  const end = Date.parse(job.end_at);
  if (!(end > start)) return null;
  const days = dateRange(localDate(new Date(start)), localDate(new Date(end - 1)));
  const cap = buildCapacity({ ...input, days });

  const skip = new Set<string>([input.declinedCrewId, ...(input.excludeCrewIds ?? [])]);
  for (const a of input.existingAssignments) {
    if (a.job_id === job.id && ACTIVE_ASSIGNMENT_STATUSES.has(a.status)) skip.add(a.crew_id);
  }

  const minutes = job.est_minutes > 0 ? job.est_minutes : Math.round((end - start) / MINUTE);
  const candidates = Object.values(cap.crew)
    .filter((c) => !skip.has(c.crew_id) && canTake(c, start, end, minutes).ok)
    .sort(byFairness(start));
  if (!candidates.length) return null;

  const pick = candidates[0];
  const notes = [`${firstName(pick.name)} is free ${slotLabel(start, end)}`];
  if (candidates.length > 1 && weekMinutes(pick, start) < weekMinutes(candidates[1], start)) {
    notes.push("has the fewest hours this week");
  }
  return { crew_id: pick.crew_id, reason: `${notes.join(" and ")}.` };
}
