/** Calendar helpers in the business timezone (America/New_York), built on lib/scheduler/time. */
import { localDate, localTime, weekdayOf } from "../lib/scheduler/time";

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO-8601 week of a local "YYYY-MM-DD", e.g. "2026-W42". Weeks start Monday. */
export function isoWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

/** Local date as "YYYYMMDD". */
export function yyyymmdd(now: Date): string {
  return localDate(now).replace(/-/g, "");
}

export type Season = "spring" | "summer" | "fall" | "winter";

/** Meteorological season of the local month: Mar–May spring, Jun–Aug summer, Sep–Nov fall, Dec–Feb winter. */
export function seasonOf(now: Date): Season {
  const month = Number(localDate(now).slice(5, 7));
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

/** `weather:<yyyy-mm-dd>-<0..3>`: one weather watch per 6-hour local block. */
export function weatherDedupeKey(now: Date): string {
  const hour = Number(localTime(now).slice(0, 2));
  return `weather:${localDate(now)}-${Math.floor(hour / 6)}`;
}

/** True from Monday 07:00 local onward through Sunday: the weekly ad drafts for this ISO week are due. */
export function weeklyAdsDue(now: Date): boolean {
  const day = weekdayOf(localDate(now));
  return !(day === 1 && localTime(now) < "07:00");
}

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
