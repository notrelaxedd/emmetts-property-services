/**
 * The knock-now light, the plain-English window, the next good time and the 7-day strip.
 * Pure: no next/* or db imports, no date libraries (Intl only, America/New_York like windows.ts).
 *
 * A light never shows a number. green = a good time, yellow = maybe, red = probably not home:
 *   green   the hour is inside the window (a range, or "anytime" on a matching day)
 *   yellow  within 1 hour before/after the range; or the day kind differs but the window is "anytime";
 *           or the learned bucket for that hour has a mean answer rate in [0.25, 0.45)
 *   red     everything else
 */
import type { BlockGroup, Parcel } from "../db/types";
import { typicalCommute } from "./census";
import type { TimeWindow, WindowResult } from "./types";
import { CANVASS_TZ, dayKindOf, formatWindow, learnedBucketAt, type LearnedWindow } from "./windows";

export type Light = "green" | "yellow" | "red";

export type KnockNow = {
  light: Light;
  /** "Good now" | "Maybe" | "Probably not home". */
  label: string;
  /** "today 4:30pm", "tomorrow 4pm", "Saturday 9am"; null when the light is green or nothing is green within 7 days. */
  nextGoodTime: string | null;
  /** The same moment as an ISO instant. */
  nextGoodAt: string | null;
};

export type StripDay = { day: 0 | 1 | 2 | 3 | 4 | 5 | 6; blocks: { hour: number; light: Light }[] };

export const LIGHT_LABELS: Record<Light, string> = { green: "Good now", yellow: "Maybe", red: "Probably not home" };
/** Light colours for dots and strip blocks (green, amber, red). */
export const LIGHT_COLORS: Record<Light, string> = { green: "#16A34A", yellow: "#EAB308", red: "#DC2626" };

/** An "anytime" window means these local hours (9am up to 8pm): nobody wants a knock at 6am or 10pm. */
export const ANYTIME_START = 9;
export const ANYTIME_END = 20;
/** Yellow margin either side of a range, in hours. */
const MARGIN = 1;
/** A learned bucket with a mean answer rate in this band turns a red hour yellow. */
export const LEARNED_YELLOW_MIN = 0.25;
export const LEARNED_YELLOW_MAX = 0.45;
const EPS = 1e-6;

// ---------- Local time (Intl only) ----------

type LocalParts = { weekday: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date: Date, timezone: string): LocalParts {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timezone, f);
  }
  const out: LocalParts = { weekday: 0, hour: 0, minute: 0 };
  for (const p of f.formatToParts(date)) {
    if (p.type === "weekday") out.weekday = WEEKDAY_INDEX[p.value] ?? 0;
    else if (p.type === "hour") out.hour = Number(p.value) % 24;
    else if (p.type === "minute") out.minute = Number(p.value);
  }
  return out;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 16 → "4pm", 16.5 → "4:30pm", 12 → "12pm" (nearest half hour). */
export function clockLabel(hour: number): string {
  const halves = Math.round(hour * 2);
  const h = Math.floor(halves / 2) % 24;
  const mins = halves % 2 === 1 ? ":30" : "";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${mins}${h < 12 ? "am" : "pm"}`;
}

// ---------- Lights ----------

/** The span of hours on `weekday` that counts as green for this window, or null when the day does not match. */
function greenSpan(window: TimeWindow, weekday: number): [number, number] | null {
  if (window.days !== "any" && window.days !== dayKindOf(weekday)) return null;
  return window.kind === "anytime" ? [ANYTIME_START, ANYTIME_END] : [window.start, Math.min(24, window.end)];
}

const overlaps = (a: number, b: number, s: number, e: number) => a < e && b > s;

/** The light for the time span [from, to) (decimal local hours) on a weekday. */
function lightForSpan(window: TimeWindow, weekday: number, from: number, to: number, learned?: LearnedWindow | null): Light {
  let light: Light = "red";
  const span = greenSpan(window, weekday);
  if (span) {
    if (overlaps(from, to, span[0], span[1])) light = "green";
    else if (overlaps(from, to, span[0] - MARGIN, span[1] + MARGIN)) light = "yellow";
  } else if (window.kind === "anytime" && overlaps(from, to, ANYTIME_START, ANYTIME_END)) {
    light = "yellow"; // "anytime weekdays" on a Saturday: maybe
  }
  if (light === "red" && learned) {
    const bucket = learnedBucketAt(learned, { weekday, hour: Math.floor(from) });
    if (bucket && bucket.mean >= LEARNED_YELLOW_MIN && bucket.mean < LEARNED_YELLOW_MAX) light = "yellow";
  }
  return light;
}

/** The light for one whole local hour block (hour 16 = 4:00-5:00pm) on a weekday (0 = Sunday … 6 = Saturday). */
export function lightAt(window: TimeWindow, weekday: number, hour: number, learned?: LearnedWindow | null): Light {
  return lightForSpan(window, weekday, hour, hour + 1, learned);
}

// ---------- Next good time ----------

/** Instant of local `minutesOfDay` on the calendar day `dayOffset` days after `now`'s local day (DST-safe). */
function instantAt(now: Date, dayOffset: number, minutesOfDay: number, timezone: string): Date {
  const base = Math.floor(now.getTime() / 60000) * 60000;
  const here = localParts(now, timezone);
  let candidate = base + (dayOffset * 1440 + minutesOfDay - (here.hour * 60 + here.minute)) * 60000;
  const got = localParts(new Date(candidate), timezone);
  let diff = minutesOfDay - (got.hour * 60 + got.minute);
  if (diff > 720) diff -= 1440;
  if (diff <= -720) diff += 1440;
  if (diff !== 0) candidate += diff * 60000;
  return new Date(candidate);
}

/**
 * The next green block that starts after `now` within the next 7 days (today + 6 more local days covers every weekday and weekend), rounded to the window start
 * (":30" allowed). A block you are already inside does not count. Null when no day matches.
 */
export function nextGreenBlock(window: TimeWindow, now: Date, timezone = CANVASS_TZ): { label: string; at: string } | null {
  const here = localParts(now, timezone);
  const t = here.hour + here.minute / 60;
  for (let d = 0; d <= 6; d++) {
    const weekday = (here.weekday + d) % 7;
    const span = greenSpan(window, weekday);
    if (!span) continue;
    const start = Math.round(span[0] * 2) / 2;
    if (d === 0 && t >= span[1]) continue; // window over for today
    if (d === 0 && t >= span[0]) continue; // already inside: not a "next" block
    const day = d === 0 ? "today" : d === 1 ? "tomorrow" : DAY_NAMES[weekday];
    return { label: `${day} ${clockLabel(start)}`, at: instantAt(now, d, Math.round(start * 60), timezone).toISOString() };
  }
  return null;
}

/** The light right now, its label, and (when it is not green) when the next good time is. */
export function knockNow(window: TimeWindow, now: Date, timezone = CANVASS_TZ, learned?: LearnedWindow | null): KnockNow {
  const here = localParts(now, timezone);
  const t = here.hour + here.minute / 60;
  const light = lightForSpan(window, here.weekday, t, t + EPS, learned);
  const next = light === "green" ? null : nextGreenBlock(window, now, timezone);
  return { light, label: LIGHT_LABELS[light], nextGoodTime: next?.label ?? null, nextGoodAt: next?.at ?? null };
}

// ---------- Plain-English window ----------

const CREW_TEXT: Record<string, string> = {
  home_weekdays: "home on weekdays",
  evenings_only: "evenings only",
  weekends_only: "weekends only",
};

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** True for the ACS "someone is home in the day" window (weekdays ~10-4, or anytime weekdays). */
function isDaytimeWindow(w: TimeWindow): boolean {
  if (w.days !== "weekdays") return false;
  return w.kind === "anytime" || (w.start <= 10 && w.end >= 16);
}

/**
 * What the crew reads: one line for when, one for why. No percentages. Stated windows win and keep the
 * words they were given ("Homeowner said: come back after 5 on weekdays.").
 *
 * Note: the ACS return-home line reads "Weekdays after 4pm, Saturdays all day" (the area's weekend habit),
 * while the light itself only follows the resolved window (weekdays 4-6pm), so Saturday may show yellow/red.
 */
export function plainWindow(
  w: WindowResult,
  bg: Pick<BlockGroup, "pct_not_in_lf" | "pct_hh_nonworking_parent" | "commute_dist" | "depart_dist"> | null,
  parcel: Pick<Parcel, "callback_window" | "home_pattern">,
): { text: string; reason: string } {
  if (w.source === "none" && w.label === "Do not knock") {
    return { text: "Do not knock", reason: "this house asked not to be contacted." };
  }

  if (w.source === "homeowner") {
    const stated = parcel.callback_window?.trim().replace(/[.\s]+$/, "");
    return { text: stated ? `Homeowner said: ${stated}.` : sentence(`Homeowner said: ${w.label}`), reason: "they told us when to come back." };
  }

  if (w.source === "crew") {
    const note = parcel.home_pattern ? CREW_TEXT[parcel.home_pattern] : undefined;
    return {
      text: note ? `Crew noted: ${note}.` : sentence(`Crew noted: ${w.label.replace(/\s*\(crew\)$/, "").toLowerCase()}`),
      reason: "somebody on the crew saw this at the door.",
    };
  }

  if (w.source === "learned") {
    return { text: formatWindow(w.window, ""), reason: "that's when doors on this block have opened for us." };
  }

  if (w.source === "acs") {
    if (isDaytimeWindow(w.window)) {
      return { text: "Good anytime weekdays", reason: "lots of households here have someone home during the day." };
    }
    const commute = bg ? typicalCommute(bg.commute_dist) : null;
    const reason =
      commute !== null
        ? `most people here commute ~${Math.max(5, Math.round(commute / 5) * 5)} min to day jobs.`
        : "most people here work away from home during the day.";
    const start = w.window.kind === "range" ? w.window.start : 17;
    return { text: `Weekdays after ${clockLabel(start)}, Saturdays all day`, reason };
  }

  return { text: `${formatWindow(w.window, "")} (default)`, reason: "no area data yet." };
}

// ---------- Week strip ----------

/** Display order Monday … Sunday. */
const STRIP_ORDER: StripDay["day"][] = [1, 2, 3, 4, 5, 6, 0];

/**
 * Seven days Mon..Sun, one block per hour, coloured only: weekdays 2pm-8pm (hours 14..20), Saturday and Sunday
 * 9am-8pm (hours 9..20). `timezone` is accepted for symmetry with knockNow; the strip is in local clock hours.
 */
export function weekStrip(window: TimeWindow, learned: LearnedWindow | null, _timezone = CANVASS_TZ): StripDay[] {
  return STRIP_ORDER.map((day) => {
    const first = day === 0 || day === 6 ? 9 : 14;
    const blocks: StripDay["blocks"] = [];
    for (let hour = first; hour <= 20; hour++) blocks.push({ hour, light: lightAt(window, day, hour, learned) });
    return { day, blocks };
  });
}
