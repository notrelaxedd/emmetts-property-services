/**
 * The parent view (/parent): where and when the crew is working. Pure: no database, no clock.
 *
 * Only times, addresses and service names go in. Never prices, customer names, phone numbers or
 * emails: the page has no login, so anything built here is effectively public.
 */
import type { JobStatus, SnowRouteStop } from "@/lib/db/types";
import { localDate } from "@/lib/scheduler/time";

/** Jobs on the calendar. `unscheduled` has no slot; `cancelled` isn't happening. */
export const PARENT_JOB_STATUSES: JobStatus[] = ["proposed", "crew_confirmed", "booked", "in_progress", "done"];
/** Not confirmed with the customer yet: may still move. */
const TENTATIVE: JobStatus[] = ["proposed", "crew_confirmed"];

export type ParentJobInput = {
  start_at: string;
  end_at: string | null;
  est_minutes: number;
  status: JobStatus;
  weather_hold: boolean;
  address: string | null;
  services: string[];
};

export type ParentRouteInput = {
  start_at: string;
  finish_at: string;
  stops: Pick<SnowRouteStop, "address" | "arrive_at" | "done_at">[];
};

export type ParentPlace = { address: string; start: string | null; end: string | null };

export type ParentEntry = {
  kind: "job" | "mow" | "snow";
  title: string;
  start: string;
  end: string;
  places: ParentPlace[];
  /** "Tentative" / "Weather hold" / "Done", or null. */
  note: string | null;
};

export type ParentDay = { date: string; entries: ParentEntry[] };

const NO_ADDRESS = "Address not on file";

function jobEntry(j: ParentJobInput): ParentEntry {
  const end = j.end_at ?? new Date(new Date(j.start_at).getTime() + Math.max(30, j.est_minutes) * 60_000).toISOString();
  const note = j.weather_hold ? "Weather hold" : j.status === "done" ? "Done" : TENTATIVE.includes(j.status) ? "Tentative" : null;
  const title = j.services.length ? Array.from(new Set(j.services)).join(", ") : "Yard job";
  return { kind: "job", title, start: j.start_at, end, places: [{ address: j.address?.trim() || NO_ADDRESS, start: null, end: null }], note };
}

function routeEntry(kind: "mow" | "snow", r: ParentRouteInput): ParentEntry {
  const stops = [...(r.stops ?? [])].sort((a, b) => a.arrive_at.localeCompare(b.arrive_at));
  return {
    kind,
    title: kind === "mow" ? "Mowing route" : "Snow route",
    start: r.start_at,
    end: r.finish_at,
    places: stops.map((s) => ({ address: s.address?.trim() || NO_ADDRESS, start: s.arrive_at, end: s.done_at })),
    note: null,
  };
}

/** Every day from `days` (local "YYYY-MM-DD"), each with its entries in start order. Empty days stay in. */
export function buildParentWeek(
  days: string[],
  input: { jobs: ParentJobInput[]; mowRoutes: ParentRouteInput[]; snowRoutes: ParentRouteInput[] },
): ParentDay[] {
  const byDay = new Map<string, ParentEntry[]>(days.map((d) => [d, []]));
  const all = [
    ...input.jobs.filter((j) => PARENT_JOB_STATUSES.includes(j.status)).map(jobEntry),
    ...input.mowRoutes.map((r) => routeEntry("mow", r)),
    ...input.snowRoutes.map((r) => routeEntry("snow", r)),
  ];
  for (const e of all) byDay.get(localDate(new Date(e.start)))?.push(e);
  return days.map((date) => ({ date, entries: (byDay.get(date) ?? []).sort((a, b) => a.start.localeCompare(b.start)) }));
}
