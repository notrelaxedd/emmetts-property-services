/** Test fixtures for the scheduler (imported only by *.test.ts; not re-exported from index). */
import type {
  AssignmentStatus,
  CrewAvailability,
  CrewException,
  Job,
  OwnerException,
  OwnerWindow,
  Profile,
  Weekday,
} from "../db/types";
import { zonedToUtc } from "./time";
import type { ExistingAssignment, SchedulerInput } from "./types";

const T = "2026-01-01T00:00:00.000Z";
const base = (id: string) => ({ id, created_at: T, updated_at: T });

/** Local date + time in America/New_York → ISO UTC. */
export const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm).toISOString();

/** Sunday Oct 11 2026, 8:00am EDT. The week under test is Mon Oct 12 – Sun Oct 18. */
export const NOW = new Date(at("2026-10-11", "08:00"));

export function crew(id: string, name: string, over: Partial<Profile> = {}): Profile {
  return {
    ...base(id),
    user_id: `u-${id}`,
    role: "crew",
    name,
    email: null,
    phone: null,
    max_hours_week: 40,
    paused: false,
    hourly_rate: 20,
    lat: null,
    lng: null,
    ...over,
  };
}

export function block(crewId: string, weekday: Weekday, start_time: string, end_time: string): CrewAvailability {
  return { ...base(`b-${crewId}-${weekday}-${start_time}`), crew_id: crewId, weekday, start_time, end_time };
}

/** Same block on Mon–Fri. */
export function weekdays(crewId: string, start = "08:00", end = "17:00"): CrewAvailability[] {
  return ([1, 2, 3, 4, 5] as Weekday[]).map((d) => block(crewId, d, start, end));
}

export function ownerWindow(weekday: Weekday, start_time = "08:00", end_time = "17:00"): OwnerWindow {
  return { ...base(`w-${weekday}-${start_time}`), weekday, start_time, end_time };
}

export const OWNER_MON_FRI: OwnerWindow[] = ([1, 2, 3, 4, 5] as Weekday[]).map((d) => ownerWindow(d));

export function ownerException(date: string, over: Partial<OwnerException> = {}): OwnerException {
  return { ...base(`oe-${date}`), date, closed: true, start_time: null, end_time: null, note: null, ...over };
}

export function crewException(
  crewId: string,
  date_from: string,
  over: Partial<CrewException> = {},
): CrewException {
  return {
    ...base(`ce-${crewId}-${date_from}-${over.kind ?? "off"}-${over.start_time ?? ""}`),
    crew_id: crewId,
    date_from,
    date_to: over.date_to ?? date_from,
    start_time: null,
    end_time: null,
    kind: "off",
    status: "approved",
    note: null,
    ...over,
  };
}

export function job(id: string, over: Partial<Job> = {}): Job {
  return {
    ...base(id),
    quote_id: null,
    customer_id: `cust-${id}`,
    status: "unscheduled",
    start_at: null,
    end_at: null,
    est_minutes: 60,
    crew_size: 1,
    paid: true,
    weather_hold: false,
    paid_at: "2026-10-01T12:00:00.000Z",
    deadline: null,
    schedule_reason: null,
    resolve_reason: null,
    owner_hold: false,
    weather_hold_date: null,
    actual_minutes: null,
    started_at: null,
    completed_at: null,
    completion_photo_paths: [],
    notes: null,
    ...over,
  };
}

export function assignment(
  crewId: string,
  jobId: string,
  start_at: string,
  end_at: string,
  over: Partial<ExistingAssignment> = {},
): ExistingAssignment {
  return {
    ...base(`a-${jobId}-${crewId}`),
    job_id: jobId,
    crew_id: crewId,
    status: "accepted" as AssignmentStatus,
    responded_at: null,
    swap_to_crew_id: null,
    start_at,
    end_at,
    est_minutes: Math.round((Date.parse(end_at) - Date.parse(start_at)) / 60_000),
    ...over,
  };
}

export function input(over: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    jobs: [],
    crew: [],
    ownerWindows: OWNER_MON_FRI,
    ownerExceptions: [],
    crewAvailability: [],
    crewExceptions: [],
    existingAssignments: [],
    customers: {},
    settings: { drop_notice_hours: 48 },
    now: NOW,
    ...over,
  };
}
