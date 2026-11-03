/** Which mowing customers are due when. Pure; dates are local "YYYY-MM-DD". */
import type { MowFrequency } from "../db/types";
import { weekStart } from "../scheduler/time";

const DAY_MS = 86_400_000;

function weeksBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${weekStart(b)}T12:00:00Z`) - Date.parse(`${weekStart(a)}T12:00:00Z`)) / (7 * DAY_MS));
}

/** Weekly: every week. Biweekly: the anchor's week and every other week after (or before) it. */
export function dueThisWeek(frequency: MowFrequency, anchorDate: string, date: string): boolean {
  if (frequency === "weekly") return true;
  return Math.abs(weeksBetween(anchorDate, date)) % 2 === 0;
}

export type Season = { season_start: string | null; season_end: string | null };

/** Inside the mowing season (either end may be open). */
export function inSeason(season: Season, date: string): boolean {
  if (season.season_start && date < season.season_start) return false;
  if (season.season_end && date > season.season_end) return false;
  return true;
}

/** In season, due that week, not cut yet that week, and the day matches their preferred day (or they have none). */
export function dueOnDate(
  c: { frequency: MowFrequency; anchor_date: string; preferred_day: number | null; active: boolean },
  date: string,
  cutThisWeek: boolean,
  season: Season = { season_start: null, season_end: null },
): boolean {
  if (!inSeason(season, date)) return false;
  if (!c.active || cutThisWeek || !dueThisWeek(c.frequency, c.anchor_date, date)) return false;
  if (c.preferred_day === null) return true;
  return new Date(`${date}T12:00:00Z`).getUTCDay() === c.preferred_day;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const FREQUENCY_LABEL: Record<MowFrequency, string> = { weekly: "Weekly", biweekly: "Every 2 weeks" };
