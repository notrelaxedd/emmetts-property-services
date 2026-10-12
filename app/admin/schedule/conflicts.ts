/**
 * Pure checks for moving a job on the schedule (drag & drop). No I/O, no framework imports.
 * Reuses the scheduler's interval helpers so "free" means the same thing here and in the solver.
 */
import type { CrewAvailability, CrewException, OwnerException, OwnerWindow } from "@/lib/db/types";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  covers,
  crewAvailableForDay,
  overlaps,
  ownerOpenForDay,
} from "@/lib/scheduler/capacity";
import { formatDayLabel, formatTimeRange, localDate } from "@/lib/scheduler/time";
import type { AssignmentStatus } from "@/lib/db/types";

export type MoveCrew = { id: string; name: string };

/** Another job's assignment for one of the crew, with that job's times. */
export type BusyAssignment = {
  crew_id: string;
  job_id: string;
  status: AssignmentStatus;
  start_at: string | null;
  end_at: string | null;
};

export type MoveCheckInput = {
  jobId: string;
  start: Date;
  end: Date;
  crew: MoveCrew[];
  ownerWindows: OwnerWindow[];
  ownerExceptions: OwnerException[];
  crewAvailability: CrewAvailability[];
  /** Any status; only `approved` ones count. */
  crewExceptions: CrewException[];
  /** Assignments of the same crew on other jobs. */
  otherAssignments: BusyAssignment[];
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Null when the move is fine, else a short human reason for the toast. */
export function checkMove(input: MoveCheckInput): string | null {
  const s = input.start.getTime();
  const e = input.end.getTime();
  if (!(e > s)) return "That job has no length.";
  const date = localDate(input.start);
  if (localDate(new Date(e - 1)) !== date) return "A job can't run past midnight.";
  const slot = `${formatDayLabel(input.start)} ${formatTimeRange(input.start, input.end)}`;

  const open = ownerOpenForDay(date, input.ownerWindows, input.ownerExceptions);
  if (!covers(open, s, e)) return `${slot} is outside your open hours.`;

  for (const c of input.crew) {
    const who = firstName(c.name);
    const busy = input.otherAssignments.some(
      (a) =>
        a.crew_id === c.id &&
        a.job_id !== input.jobId &&
        ACTIVE_ASSIGNMENT_STATUSES.has(a.status) &&
        a.start_at &&
        a.end_at &&
        overlaps([{ start: Date.parse(a.start_at), end: Date.parse(a.end_at) }], s, e),
    );
    if (busy) return `${who} is on another job then.`;

    const approved = input.crewExceptions.filter((x) => x.crew_id === c.id && x.status === "approved");
    const avail = crewAvailableForDay(c.id, date, input.crewAvailability, approved);
    if (!covers(avail, s, e)) {
      const weekly = crewAvailableForDay(c.id, date, input.crewAvailability, []);
      if (covers(weekly, s, e)) return `${who} has approved time off then.`;
      return `${who} isn't available ${slot}.`;
    }
  }
  return null;
}
