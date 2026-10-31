import type { CrewAvailability, CrewException } from "@/lib/db/types"
import { crewAvailableForDay } from "@/lib/scheduler/capacity"
import { addDays, localDate, weekdayOf } from "@/lib/scheduler/time"

/** The next Saturday on or after today, and the Sunday after it, as local "YYYY-MM-DD". */
export function upcomingWeekend(now: Date = new Date()): { sat: string; sun: string } {
  const today = localDate(now)
  const sat = addDays(today, (6 - weekdayOf(today) + 7) % 7)
  return { sat, sun: addDays(sat, 1) }
}

/** Whether a crew member has any working hours on `date` (weekly blocks − approved time off + approved extra days). */
export function freeOn(crewId: string, date: string, blocks: CrewAvailability[], exceptions: CrewException[]): boolean {
  return crewAvailableForDay(crewId, date, blocks, exceptions).length > 0
}
