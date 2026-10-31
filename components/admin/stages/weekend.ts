import type { CrewAvailability, CrewException } from "@/lib/db/types"
import { crewAvailableForDay } from "@/lib/scheduler/capacity"
import { addDays, localDate, weekdayOf } from "@/lib/scheduler/time"

/** The coming Saturday and Sunday (today when it is one), as local "YYYY-MM-DD". */
export function upcomingWeekend(now: Date = new Date()): { sat: string; sun: string } {
  const today = localDate(now)
  const wd = weekdayOf(today)
  const sat = wd === 0 ? addDays(today, -1) : addDays(today, (6 - wd + 7) % 7)
  // On a Sunday the weekend in progress is the one shown (Saturday already passed, Sunday is today).
  return { sat, sun: addDays(sat, 1) }
}

/** Whether a crew member has any working hours on `date` (weekly blocks − approved time off + approved extra days). */
export function freeOn(crewId: string, date: string, blocks: CrewAvailability[], exceptions: CrewException[]): boolean {
  return crewAvailableForDay(crewId, date, blocks, exceptions).length > 0
}
