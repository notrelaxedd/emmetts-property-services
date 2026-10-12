import type {
  AssignmentStatus,
  CrewAvailability,
  CrewException,
  OwnerException,
  OwnerWindow,
  Profile,
} from "../db/types";
import { addDays, dateRange, localDate, weekKeyOf, weekdayOf, zonedToUtc } from "./time";
import type { Capacity, CrewCapacity, ExistingAssignment, Interval, SchedulerInput } from "./types";

// ---------- Interval helpers (half-open [start, end), epoch ms) ----------

/** Sort, drop empty intervals, and join any that overlap or touch. */
export function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** Times that are in both `a` and `b`. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const A = merge(a);
  const B = merge(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start);
    const end = Math.min(A[i].end, B[j].end);
    if (end > start) out.push({ start, end });
    if (A[i].end < B[j].end) i++;
    else j++;
  }
  return out;
}

/** Times in `a` that are not in `b`. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const B = merge(b);
  const out: Interval[] = [];
  for (const piece of merge(a)) {
    let cursor = piece.start;
    for (const cut of B) {
      if (cut.end <= cursor) continue;
      if (cut.start >= piece.end) break;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= piece.end) break;
    }
    if (cursor < piece.end) out.push({ start: cursor, end: piece.end });
  }
  return out;
}

/** True when one interval in the list fully contains [start, end). */
export function covers(intervals: Interval[], start: number, end: number): boolean {
  return intervals.some((i) => i.start <= start && i.end >= end);
}

/** True when any interval in the list overlaps [start, end). */
export function overlaps(intervals: Interval[], start: number, end: number): boolean {
  return intervals.some((i) => i.start < end && i.end > start);
}

// ---------- Local-time → interval ----------

/** A local date + "HH:MM"–"HH:MM" as a UTC interval, or null if empty. */
export function localInterval(date: string, startTime: string, endTime: string): Interval | null {
  const start = zonedToUtc(date, startTime).getTime();
  const end = zonedToUtc(date, endTime).getTime();
  return end > start ? { start, end } : null;
}

function wholeDay(date: string): Interval {
  return { start: zonedToUtc(date, "00:00").getTime(), end: zonedToUtc(addDays(date, 1), "00:00").getTime() };
}

function nonNull<T>(x: T | null | undefined): x is T {
  return x != null;
}

/**
 * Assignment statuses that hold a crew member's time and count toward weekly hours.
 * `swap_offered` is NOT one of them: that row belongs to a *candidate* who has only been asked to
 * take the job over (`swap_to_crew_id` is the holder, whose own `accepted` row still counts).
 */
export const HOLDING_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = ["offered", "accepted", "drop_requested"];
export const ACTIVE_ASSIGNMENT_STATUSES: ReadonlySet<AssignmentStatus> = new Set<AssignmentStatus>(HOLDING_ASSIGNMENT_STATUSES);

// ---------- Owner ----------

/**
 * Owner open intervals for one local date: that weekday's windows, unless an exception for the
 * date says closed (→ nothing) or gives start/end times (→ replaces the windows).
 */
export function ownerOpenForDay(
  date: string,
  windows: OwnerWindow[],
  exceptions: OwnerException[],
  closedDates: ReadonlySet<string> = new Set(),
): Interval[] {
  if (closedDates.has(date)) return [];
  const todays = exceptions.filter((e) => e.date.slice(0, 10) === date);
  if (todays.some((e) => e.closed)) return [];
  const replacements = todays.filter((e) => e.start_time && e.end_time);
  if (replacements.length) {
    return merge(replacements.map((e) => localInterval(date, e.start_time!, e.end_time!)).filter(nonNull));
  }
  const wd = weekdayOf(date);
  return merge(
    windows.filter((w) => w.weekday === wd).map((w) => localInterval(date, w.start_time, w.end_time)).filter(nonNull),
  );
}

// ---------- Crew ----------

/**
 * When a crew member can work on one local date (ignoring existing jobs):
 * (weekly blocks − approved `off`) ∪ approved `extra`. Exceptions without start/end are whole-day.
 * Pending/declined exceptions are ignored.
 */
export function crewAvailableForDay(
  crewId: string,
  date: string,
  blocks: CrewAvailability[],
  exceptions: CrewException[],
): Interval[] {
  const wd = weekdayOf(date);
  let avail = merge(
    blocks
      .filter((b) => b.crew_id === crewId && b.weekday === wd)
      .map((b) => localInterval(date, b.start_time, b.end_time))
      .filter(nonNull),
  );
  const todays = exceptions.filter(
    (e) =>
      e.crew_id === crewId &&
      e.status === "approved" &&
      e.date_from.slice(0, 10) <= date &&
      e.date_to.slice(0, 10) >= date,
  );
  const span = (e: CrewException): Interval | null =>
    e.start_time && e.end_time ? localInterval(date, e.start_time, e.end_time) : wholeDay(date);
  const off = todays.filter((e) => e.kind === "off").map(span).filter(nonNull);
  const extra = todays.filter((e) => e.kind === "extra").map(span).filter(nonNull);
  avail = subtract(avail, off);
  return merge([...avail, ...extra]);
}

/** Local dates from today (in the business timezone) through today + horizonDays. */
export function horizonDates(now: Date, horizonDays: number): string[] {
  const today = localDate(now);
  return dateRange(today, addDays(today, horizonDays));
}

export type CapacityInput = Pick<
  SchedulerInput,
  "crew" | "ownerWindows" | "ownerExceptions" | "crewAvailability" | "crewExceptions" | "existingAssignments" | "now"
> & {
  horizonDays?: number;
  closedDates?: string[];
  /** Assignments on these jobs are ignored (they are being re-solved). */
  ignoreJobIds?: Iterable<string>;
  /** Override the dates covered (default: today … today + horizonDays). */
  days?: string[];
};

function emptyCrew(p: Profile): CrewCapacity {
  return {
    crew_id: p.id,
    name: p.name,
    paused: p.paused,
    max_minutes_week: Math.max(0, p.max_hours_week) * 60,
    available: [],
    busy: [],
    free: [],
    week_minutes: {},
  };
}

/** Build owner + per-crew capacity for the horizon. Pure: same input → same output. */
export function buildCapacity(input: CapacityInput): Capacity {
  const days = input.days ?? horizonDates(input.now, input.horizonDays ?? 21);
  const closed = new Set(input.closedDates ?? []);
  const ignore = new Set(input.ignoreJobIds ?? []);

  const owner_by_day: Record<string, Interval[]> = {};
  for (const d of days) owner_by_day[d] = ownerOpenForDay(d, input.ownerWindows, input.ownerExceptions, closed);
  const owner_open = merge(days.flatMap((d) => owner_by_day[d]));

  const crew: Record<string, CrewCapacity> = {};
  for (const p of input.crew) {
    const c = emptyCrew(p);
    // Paused crew take no NEW jobs, but their existing assignments still count below.
    if (!p.paused) {
      c.available = merge(
        days.flatMap((d) => crewAvailableForDay(p.id, d, input.crewAvailability, input.crewExceptions)),
      );
    }
    crew[p.id] = c;
  }

  for (const a of input.existingAssignments) {
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(a.status) || ignore.has(a.job_id)) continue;
    const c = crew[a.crew_id];
    if (!c) continue;
    addCommitment(c, assignmentInterval(a), a.est_minutes);
  }
  for (const c of Object.values(crew)) c.free = subtract(c.available, c.busy);

  return { days, owner_by_day, owner_open, crew };
}

export function assignmentInterval(a: Pick<ExistingAssignment, "start_at" | "end_at">): Interval {
  return { start: Date.parse(a.start_at), end: Date.parse(a.end_at) };
}

function addCommitment(c: CrewCapacity, iv: Interval, minutes: number): void {
  c.busy = merge([...c.busy, iv]);
  const wk = weekKeyOf(new Date(iv.start));
  c.week_minutes[wk] = (c.week_minutes[wk] ?? 0) + minutes;
}

/** Record a new proposal against a crew member (mutates the capacity). */
export function reserve(cap: Capacity, crewId: string, iv: Interval, minutes: number): void {
  const c = cap.crew[crewId];
  if (!c) return;
  addCommitment(c, iv, minutes);
  c.free = subtract(c.available, c.busy);
}

/** Minutes committed in the Mon–Sun week containing this instant. */
export function weekMinutes(c: CrewCapacity, at: number): number {
  return c.week_minutes[weekKeyOf(new Date(at))] ?? 0;
}

/** Can this crew member take a NEW job over [start, end) worth `minutes`? */
export function canTake(
  c: CrewCapacity,
  start: number,
  end: number,
  minutes: number,
): { ok: true } | { ok: false; why: "paused" | "unavailable" | "busy" | "hours" } {
  if (c.paused) return { ok: false, why: "paused" };
  if (!covers(c.available, start, end)) return { ok: false, why: "unavailable" };
  if (overlaps(c.busy, start, end)) return { ok: false, why: "busy" };
  if (weekMinutes(c, start) + minutes > c.max_minutes_week) return { ok: false, why: "hours" };
  return { ok: true };
}
