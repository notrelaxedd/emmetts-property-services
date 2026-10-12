import type {
  CrewAvailability,
  CrewException,
  Job,
  JobAssignment,
  OwnerException,
  OwnerWindow,
  Profile,
  Settings,
  Weekday,
} from "../db/types";

/** Half-open interval [start, end) in epoch milliseconds (UTC). */
export type Interval = { start: number; end: number };

/**
 * An assignment on some other (already scheduled) job, joined with that job's times.
 * Statuses `offered`, `accepted`, `swap_offered` and `drop_requested` hold the crew member;
 * `declined` and `dropped` are ignored. `customer_id` is optional and only used for the
 * "next door to the Smith job" proximity bonus.
 */
export type ExistingAssignment = JobAssignment & {
  start_at: string;
  end_at: string;
  est_minutes: number;
  customer_id?: string | null;
};

export type CustomerInfo = {
  lat: number | null;
  lng: number | null;
  preferred_days: Weekday[];
  /** Optional, used in reason strings ("next door to the Smith job"). */
  name?: string | null;
};

export type SchedulerInput = {
  /** Jobs to place: `unscheduled`, or the re-solve set. Any existing assignments on these jobs are ignored. */
  jobs: Job[];
  crew: Profile[];
  ownerWindows: OwnerWindow[];
  ownerExceptions: OwnerException[];
  crewAvailability: CrewAvailability[];
  /** Only `approved` rows matter. */
  crewExceptions: CrewException[];
  existingAssignments: ExistingAssignment[];
  customers: Record<string, CustomerInfo>;
  settings: Pick<Settings, "drop_notice_hours">;
  now: Date;
  /** Days ahead to search (default 21). */
  horizonDays?: number;
  /** Candidate slot step in minutes (default 30). */
  slotStepMinutes?: number;
  /** Extra local dates ("YYYY-MM-DD") to treat as closed, e.g. a weather hold day. */
  closedDates?: string[];
};

export type Proposal = {
  job_id: string;
  start_at: string;
  end_at: string;
  crew_ids: string[];
  reason: string;
};

export type Unschedulable = { job_id: string; reason: string };

export type SchedulerResult = {
  proposals: Proposal[];
  unschedulable: Unschedulable[];
};

export type CrewCapacity = {
  crew_id: string;
  name: string;
  paused: boolean;
  /** max_hours_week × 60. */
  max_minutes_week: number;
  /** When they said they can work (weekly blocks − approved off + approved extra). Empty when paused. */
  available: Interval[];
  /** Time already taken by existing assignments (and proposals made in this run). Kept even when paused. */
  busy: Interval[];
  /** available − busy. */
  free: Interval[];
  /** Minutes committed per Mon–Sun week, keyed by the week's Monday ("YYYY-MM-DD"). */
  week_minutes: Record<string, number>;
};

export type Capacity = {
  /** Local dates covered, in order. */
  days: string[];
  /** Owner open intervals per local date. */
  owner_by_day: Record<string, Interval[]>;
  /** All owner open intervals, merged and sorted. */
  owner_open: Interval[];
  crew: Record<string, CrewCapacity>;
};

export type CoverResult = { crew_id: string; reason: string };
