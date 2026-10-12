/**
 * Wall-clock helpers for the business timezone. All owner windows, crew blocks and exception
 * dates are local to `America/New_York`; job times are absolute (ISO UTC). No date libraries:
 * only `Intl.DateTimeFormat`, so this runs the same in Next and on the fleet boxes (Node 20).
 */

export const BUSINESS_TZ = "America/New_York";

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallParts(date: Date): WallParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Minutes the business timezone is ahead of UTC at this instant (EDT = -240, EST = -300). */
export function tzOffsetMinutes(date: Date): number {
  const w = wallParts(date);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const actual = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - actual) / MINUTE);
}

/** "09:00", "9:00" or Postgres "09:00:00" → minutes after midnight. "24:00" → 1440. */
export function parseHHMM(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(hhmm.trim());
  if (!m) throw new Error(`Bad time "${hhmm}" (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Bad time "${hhmm}"`);
  return h * 60 + min;
}

function parseDate(dateStr: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) throw new Error(`Bad date "${dateStr}" (expected YYYY-MM-DD)`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Local date + wall time in the business timezone → the UTC instant.
 * Spring-forward gaps (02:30 on the March change day) resolve forward to the next real time;
 * fall-back repeats (01:30 on the November change day) resolve to the first (EDT) occurrence.
 */
export function zonedToUtc(dateStr: string, hhmm: string): Date {
  const { y, m, d } = parseDate(dateStr);
  const mins = parseHHMM(hhmm);
  const naive = Date.UTC(y, m - 1, d, 0, mins);
  // Try both candidate offsets around the instant and keep the one that round-trips.
  const o1 = tzOffsetMinutes(new Date(naive));
  const c1 = naive - o1 * MINUTE;
  const o2 = tzOffsetMinutes(new Date(c1));
  if (o1 === o2) return new Date(c1);
  const c2 = naive - o2 * MINUTE;
  // Prefer the candidate whose wall time matches; earlier one on ambiguity.
  const ok1 = tzOffsetMinutes(new Date(c1)) === o1;
  const ok2 = tzOffsetMinutes(new Date(c2)) === o2;
  if (ok1 && ok2) return new Date(Math.min(c1, c2));
  if (ok1) return new Date(c1);
  if (ok2) return new Date(c2);
  // Inside a spring-forward gap: no wall time exists, use the later offset (moves forward).
  return new Date(naive - Math.min(o1, o2) * MINUTE);
}

/** UTC instant → local "YYYY-MM-DD" in the business timezone. */
export function localDate(date: Date): string {
  const w = wallParts(date);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** UTC instant → local "HH:MM" (24h) in the business timezone. */
export function localTime(date: Date): string {
  const w = wallParts(date);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" (timezone-free). */
export function addDays(dateStr: string, n: number): string {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, for a local calendar date. */
export function weekdayOf(dateStr: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const { y, m, d } = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** Monday ("YYYY-MM-DD") of the Mon–Sun week containing this local date. */
export function weekStart(dateStr: string): string {
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, -((wd + 6) % 7));
}

/** Week key (its Monday) for a UTC instant, using the local date. */
export function weekKeyOf(date: Date): string {
  return weekStart(localDate(date));
}

/** Inclusive list of local dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const labelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Tue Oct 14" */
export function formatDayLabel(date: Date): string {
  return labelFormatter.format(date).replace(/,/g, "");
}

function clock(date: Date): { text: string; pm: boolean } {
  const w = wallParts(date);
  const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return { text: `${h12}:${pad(w.minute)}`, pm: w.hour >= 12 };
}

/** "9:00–10:30am", "11:30am–1:00pm", "1:00–2:30pm". */
export function formatTimeRange(start: Date, end: Date): string {
  const s = clock(start);
  const e = clock(end);
  const eSuffix = e.pm ? "pm" : "am";
  if (s.pm === e.pm) return `${s.text}–${e.text}${eSuffix}`;
  return `${s.text}${s.pm ? "pm" : "am"}–${e.text}${eSuffix}`;
}

/** "2h 30m", "45m", "3h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
