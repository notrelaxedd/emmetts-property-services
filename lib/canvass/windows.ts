/**
 * When to knock: every answer is a RANGE (a 2-hour-or-wider bucket, or "anytime weekdays"), never a
 * minute-level prediction. Pure: no next/* or db imports, no date libraries (Intl only).
 *
 * Priority for one house (`resolveWindow`): what the homeowner said → the crew's `home_pattern` tag →
 * the learned layer (Beta-Binomial over our own knock log, once there are enough knocks) → the ACS
 * block-group prior (works on day one) → a plain default.
 */
import type { BlockGroup, CanvassSettings, HomePattern, Knock, Parcel, Weekday } from "../db/types";
import type { PriorWindow, TimeWindow, WindowDays, WindowResult } from "./types";

export const CANVASS_TZ = "America/New_York";

/** First / last bucket start considered a reasonable knocking hour (6am … 8–10pm). */
export const FIRST_BUCKET_START = 6;
export const LAST_BUCKET_START = 20;

/** The window used when nothing else is known: weekday early evening. */
export const DEFAULT_WINDOW: TimeWindow = { kind: "range", days: "weekdays", start: 17, end: 19 };
export const NO_DATA_REASON = "No area data yet";

// ---------- Buckets and labels ----------

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Snap an hour range onto even 2-hour buckets (6–8, 8–10 … 18–20): the start rounds down to an even
 * hour, the end rounds up, and the result is always at least 2 hours wide and inside 0–24.
 */
export function bucketRange(startHour: number, endHour: number): { start: number; end: number } {
  const lo = clamp(Math.min(startHour, endHour), 0, 24);
  const hi = clamp(Math.max(startHour, endHour), 0, 24);
  let start = Math.floor(lo / 2) * 2;
  let end = Math.ceil(hi / 2) * 2;
  if (end - start < 2) end = start + 2;
  if (end > 24) {
    end = 24;
    start = Math.min(start, 22);
  }
  return { start, end };
}

/** 0 → "12am", 9 → "9am", 12 → "12pm", 17 → "5pm", 24 → "12am". */
export function formatHour(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? "am" : "pm"}`;
}

/** "4–6pm" (one suffix when both ends share it), "10am–12pm", "11pm–12am". Real en dash. */
export function formatHourRange(start: number, end: number): string {
  const s = ((Math.round(start) % 24) + 24) % 24;
  const e = ((Math.round(end) % 24) + 24) % 24;
  const sameHalf = s < 12 === e < 12 && !(e === 0 && s !== 0);
  if (sameHalf) {
    const a = formatHour(s);
    return `${a.slice(0, -2)}–${formatHour(e)}`;
  }
  return `${formatHour(s)}–${formatHour(e)}`;
}

const DAYS_LABEL: Record<WindowDays, string> = { weekdays: "Weekdays", weekends: "Weekends", any: "Any day" };
const DAYS_LOWER: Record<WindowDays, string> = { weekdays: "weekdays", weekends: "weekends", any: "" };

/**
 * "Weekdays 4–6pm likely", "Weekends 10am–12pm likely", "Anytime weekdays", "Anytime".
 * `suffix` replaces "likely" (e.g. "(homeowner)", "(crew)"); pass "" for none.
 */
export function formatWindow(window: TimeWindow, suffix = "likely"): string {
  if (window.kind === "anytime") {
    const days = DAYS_LOWER[window.days];
    return days ? `Anytime ${days}` : "Anytime";
  }
  const tail = suffix ? ` ${suffix}` : "";
  return `${DAYS_LABEL[window.days]} ${formatHourRange(window.start, window.end)}${tail}`;
}

// ---------- Homeowner-stated windows ----------

export type StatedWindow = {
  window: TimeWindow;
  /** "Weekdays 5–9pm (homeowner)" or, when the text could not be read, "Homeowner: <text>". */
  label: string;
  /** False when the text could not be understood (window is then "anytime, any day"). */
  parsed: boolean;
};

const WEEKDAY_WORDS = /\b(week ?days?|weeknights?|during the week|mon(day)?s?|tue(s|sday)?s?|wed(nesday)?s?|thu(rs|rsday)?s?|fri(day)?s?|m-f|mon-fri|after work)\b/;
const WEEKEND_WORDS = /\b(week ?ends?|sat(urday)?s?|sun(day)?s?|sat\/sun)\b/;

/** "5" / "5pm" / "5:30" / "17" → decimal hour (24h); `pmByDefault` lifts small ambiguous hours to the afternoon. */
function clockHour(raw: string, ampm: string | undefined, pmByDefault: boolean): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  if (h > 24 || mins > 59) return null;
  const suffix = ampm?.replace(/\./g, "").toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  else if (suffix === "am" && h === 12) h = 0;
  else if (!suffix && pmByDefault && h >= 1 && h <= 7) h += 12;
  return h + mins / 60;
}

const AMPM = "(a\\.?m\\.?|p\\.?m\\.?)?";
const HOUR = "(\\d{1,2}(?::\\d{2})?)";

/**
 * Best-effort reading of what a homeowner said at the door. Day words pick weekdays / weekends;
 * "after 5", "before noon", "mornings", "evenings", "4-6pm", "lunch" pick the hours. Hours are
 * NOT snapped to even buckets (the homeowner's words win), but a range is always ≥ 2 hours wide.
 * Nothing recognisable → anytime / any day, labelled "Homeowner: <text>" so the words still show.
 */
export function parseStatedWindow(text: string): StatedWindow {
  const raw = text.trim();
  const t = raw.toLowerCase().replace(/\s+/g, " ");
  const days: WindowDays = WEEKDAY_WORDS.test(t) && !WEEKEND_WORDS.test(t) ? "weekdays" : WEEKEND_WORDS.test(t) && !WEEKDAY_WORDS.test(t) ? "weekends" : "any";
  const dayWords = WEEKDAY_WORDS.test(t) || WEEKEND_WORDS.test(t);

  let start: number | null = null;
  let end: number | null = null;
  let m: RegExpExecArray | null;

  if ((m = new RegExp(`\\b(?:between |from )?${HOUR} ?${AMPM} ?(?:-|–|to|and|until|till)\\s?${HOUR} ?${AMPM}`).exec(t))) {
    const e = clockHour(m[3], m[4], true);
    const s = clockHour(m[1], m[2] ?? (m[4] && e !== null && e >= 12 ? m[4] : undefined), true);
    if (s !== null && e !== null && e > s) {
      start = Math.floor(s);
      end = Math.ceil(e);
    }
  } else if ((m = new RegExp(`\\b(?:after|past|from)\\s(noon|lunch|work|dinner|${HOUR} ?${AMPM})`).exec(t))) {
    const word = m[1];
    const s = word === "noon" || word === "lunch" ? 12 : word === "work" ? 17 : word === "dinner" ? 18 : clockHour(m[2], m[3], true);
    if (s !== null) {
      start = Math.floor(s);
      end = Math.min(22, start + 4);
    }
  } else if ((m = new RegExp(`\\b(?:before|until|till|by)\\s(noon|lunch|dinner|${HOUR} ?${AMPM})`).exec(t))) {
    const word = m[1];
    const e = word === "noon" || word === "lunch" ? 12 : word === "dinner" ? 18 : clockHour(m[2], m[3], false);
    if (e !== null) {
      end = Math.ceil(e);
      start = Math.max(FIRST_BUCKET_START, end - 4);
    }
  } else if (/\b(mornings?|before noon)\b/.test(t)) {
    start = 8;
    end = 12;
  } else if (/\b(lunch(time)?|noon|midday|mid-day)\b/.test(t)) {
    start = 12;
    end = 14;
  } else if (/\bafternoons?\b/.test(t)) {
    start = 12;
    end = 17;
  } else if (/\b(evenings?|nights?|after work|supper|dinner ?time)\b/.test(t)) {
    start = 17;
    end = 21;
  }

  if (start !== null && end !== null) {
    if (end - start < 2) end = start + 2;
    if (end > 24) {
      end = 24;
      start = Math.min(start, 22);
    }
    const window: TimeWindow = { kind: "range", days, start, end };
    return { window, label: formatWindow(window, "(homeowner)"), parsed: true };
  }

  const anytime = /\b(any ?time|anytime|whenever|always|all day|any day|flexible|doesn'?t matter)\b/.test(t);
  if (dayWords || anytime) {
    const window: TimeWindow = { kind: "anytime", days };
    return { window, label: `${formatWindow(window)} (homeowner)`, parsed: true };
  }
  return { window: { kind: "anytime", days: "any" }, label: `Homeowner: ${raw}`, parsed: false };
}

// ---------- ACS block-group prior (day one) ----------

/** Block-group aggregates the prior needs; `typicalDepart` / `typicalCommute` come from census.ts. */
export type AcsStats = Pick<BlockGroup, "pct_not_in_lf" | "pct_hh_nonworking_parent"> & {
  /** Weighted-median departure for work, decimal hours (7.5 = 7:30am). */
  typicalDepart: number | null;
  /** Weighted-median one-way commute, minutes. */
  typicalCommute: number | null;
};

export type PriorSettings = Pick<
  CanvassSettings,
  "daytime_not_in_lf_threshold" | "daytime_nonworking_parent_threshold" | "work_hours"
>;

/** 0.4 → "~40%". */
export function approxPercent(r: number): string {
  return `~${Math.round(r * 100)}%`;
}

/** 7.5 → "7:30am", 16.42 → "4:30pm" (nearest half hour). */
function formatClock(decimalHours: number): string {
  const halfHours = Math.round(decimalHours * 2);
  const h = Math.floor(halfHours / 2) % 24;
  const mins = (halfHours % 2) * 30;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${mins === 0 ? "00" : "30"}${h < 12 ? "am" : "pm"}`;
}

function formatHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** The prior used when a block group has no usable ACS numbers. */
export function emptyPrior(): PriorWindow {
  return {
    daytimeFriendly: false,
    window: { ...DEFAULT_WINDOW },
    reason: NO_DATA_REASON,
    pctNotInLf: null,
    pctNonworkingParent: null,
    typicalDepart: null,
    typicalCommute: null,
  };
}

/** True when the prior rests on real ACS numbers (false for `emptyPrior()` / a null stats row). */
export function priorHasData(prior: PriorWindow | null | undefined): boolean {
  return !!prior && (prior.pctNotInLf !== null || prior.pctNonworkingParent !== null || prior.typicalDepart !== null);
}

/**
 * Day-one window from block-group aggregates. Daytime-friendly (lots of adults not in the labor
 * force, or lots of families with a parent at home) → weekdays 10–16. Otherwise a return-home bucket:
 * departure + commute + work day + commute back, snapped to an even 2-hour bucket inside 3–9pm.
 */
export function acsPrior(stats: AcsStats | null | undefined, settings: PriorSettings): PriorWindow {
  if (!stats) return emptyPrior();
  const notInLf = stats.pct_not_in_lf;
  const nonworkingParent = stats.pct_hh_nonworking_parent;
  const depart = stats.typicalDepart;
  const commute = stats.typicalCommute;
  if (notInLf === null && nonworkingParent === null && depart === null) return emptyPrior();

  const base = {
    pctNotInLf: notInLf,
    pctNonworkingParent: nonworkingParent,
    typicalDepart: depart,
    typicalCommute: commute,
  };

  if (notInLf !== null && notInLf >= settings.daytime_not_in_lf_threshold) {
    return {
      ...base,
      daytimeFriendly: true,
      window: { kind: "range", days: "weekdays", start: 10, end: 16 },
      reason: `Area: ${approxPercent(notInLf)} of households have a non-working adult → daytime OK.`,
    };
  }
  if (nonworkingParent !== null && nonworkingParent >= settings.daytime_nonworking_parent_threshold) {
    return {
      ...base,
      daytimeFriendly: true,
      window: { kind: "range", days: "weekdays", start: 10, end: 16 },
      reason: `Area: ${approxPercent(nonworkingParent)} of families with kids have a parent at home → daytime OK.`,
    };
  }

  if (depart === null) {
    // Working-age area but no commute data: fall back to the default evening bucket, say why.
    const pct = notInLf !== null ? ` (${approxPercent(notInLf)} not in labor force)` : "";
    return { ...base, daytimeFriendly: false, window: { ...DEFAULT_WINDOW }, reason: `Area: mostly working households${pct} → early evening.` };
  }

  const commuteMins = commute ?? 0;
  const home = depart + commuteMins / 60 + settings.work_hours + commuteMins / 60;
  let start = Math.floor(home / 2) * 2;
  let end = start + 2;
  if (start < 15) {
    start = 15;
    end = 17;
  } else if (end > 21) {
    start = 19;
    end = 21;
  }
  const commuteText = commute !== null ? ` + ~${Math.round(commute)} min commute` : "";
  return {
    ...base,
    daytimeFriendly: false,
    window: { kind: "range", days: "weekdays", start, end },
    reason: `Area: typical departure ~${formatClock(depart)}${commuteText} + ${formatHours(settings.work_hours)} → home ~${formatClock(home)}`,
  };
}

// ---------- Local time helpers (Intl only) ----------

export type DayKind = "weekdays" | "weekends";

export type Bucket = {
  weekday: Weekday;
  /** Local hour 0–23. */
  hour: number;
  days: DayKind;
  /** Even bucket start (hour 17 → 16), or -1 outside 6am–10pm. */
  start: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", hourCycle: "h23" });
    formatters.set(timezone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, Weekday> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const dayKindOf = (weekday: number): DayKind => (weekday === 0 || weekday === 6 ? "weekends" : "weekdays");

/** Even 2-hour bucket start for a local hour, or -1 when outside knocking hours. */
export function bucketStartOf(hour: number): number {
  const start = Math.floor(hour / 2) * 2;
  return start >= FIRST_BUCKET_START && start <= LAST_BUCKET_START ? start : -1;
}

/** Local weekday + hour of an instant in the business timezone, and the 2-hour bucket it falls in. */
export function bucketOf(date: Date | string, timezone = CANVASS_TZ): Bucket {
  const d = typeof date === "string" ? new Date(date) : date;
  let weekday: Weekday = 0;
  let hour = 0;
  for (const p of formatterFor(timezone).formatToParts(d)) {
    if (p.type === "weekday") weekday = WEEKDAY_INDEX[p.value] ?? 0;
    else if (p.type === "hour") hour = Number(p.value) % 24;
  }
  return { weekday, hour, days: dayKindOf(weekday), start: bucketStartOf(hour) };
}

// ---------- Learned layer (Beta-Binomial over our knock log) ----------

export type LearnedBucket = {
  days: DayKind;
  start: number;
  end: number;
  knocks: number;
  answers: number;
  /** Shrunk toward the prior: `alpha0 = 4, beta0 = 2` for the prior's bucket(s), `1, 3` elsewhere. */
  alpha0: number;
  beta0: number;
  /** Posterior mean P(answer). */
  mean: number;
  isPrior: boolean;
};

export type LearnedWindow = {
  window: TimeWindow;
  reason: string;
  /** Total knocks the layer was built from. */
  knocks: number;
  best: LearnedBucket;
  /** Keyed `${days}:${start}`. */
  buckets: Record<string, LearnedBucket>;
};

export const PRIOR_ALPHA = 4;
export const PRIOR_BETA = 2;
export const OTHER_ALPHA = 1;
export const OTHER_BETA = 3;

export const bucketKey = (days: DayKind, start: number) => `${days}:${start}`;

/** Posterior mean answer rate for one bucket: (alpha0 + answers) / (alpha0 + beta0 + knocks). */
export function answerProbability(bucket: { knocks: number; answers: number; alpha0?: number; beta0?: number; isPrior?: boolean }): number {
  const alpha0 = bucket.alpha0 ?? (bucket.isPrior ? PRIOR_ALPHA : OTHER_ALPHA);
  const beta0 = bucket.beta0 ?? (bucket.isPrior ? PRIOR_BETA : OTHER_BETA);
  return (alpha0 + bucket.answers) / (alpha0 + beta0 + bucket.knocks);
}

/** A knock counts as an answer unless nobody came to the door. */
export const isAnswer = (outcome: Knock["outcome"]): boolean => outcome !== "no_answer";

function priorCovers(prior: TimeWindow, days: DayKind, start: number): boolean {
  if (prior.days !== "any" && prior.days !== days) return false;
  if (prior.kind === "anytime") return true;
  return start < prior.end && start + 2 > prior.start;
}

/** The 16 empty buckets (weekdays / weekends × 6–8 … 20–22), prior ones marked. */
export function emptyLearnedBuckets(prior: TimeWindow): Record<string, LearnedBucket> {
  const out: Record<string, LearnedBucket> = {};
  for (const days of ["weekdays", "weekends"] as const) {
    for (let start = FIRST_BUCKET_START; start <= LAST_BUCKET_START; start += 2) {
      const isPrior = priorCovers(prior, days, start);
      const b: LearnedBucket = {
        days,
        start,
        end: start + 2,
        knocks: 0,
        answers: 0,
        alpha0: isPrior ? PRIOR_ALPHA : OTHER_ALPHA,
        beta0: isPrior ? PRIOR_BETA : OTHER_BETA,
        mean: 0,
        isPrior,
      };
      b.mean = answerProbability(b);
      out[bucketKey(days, start)] = b;
    }
  }
  return out;
}

/**
 * Learned window for a group of knocks (one block group or one street). Beta-Binomial per
 * weekday-vs-weekend × 2-hour bucket, shrunk toward the ACS prior; the best posterior mean wins and
 * ties go to the prior's bucket. Null until the group has `minKnocks` knocks (so the ACS prior stays
 * in charge), and knocks outside 6am–10pm are ignored.
 */
export function learnedWindow(
  knocks: readonly Pick<Knock, "knocked_at" | "outcome">[],
  prior: TimeWindow | PriorWindow | null | undefined,
  minKnocks: number,
  timezone = CANVASS_TZ,
): LearnedWindow | null {
  const priorWindow: TimeWindow = !prior ? DEFAULT_WINDOW : "kind" in prior ? prior : prior.window;
  const buckets = emptyLearnedBuckets(priorWindow);
  let total = 0;
  for (const k of knocks) {
    const b = bucketOf(k.knocked_at, timezone);
    if (b.start < 0) continue;
    const bucket = buckets[bucketKey(b.days, b.start)];
    if (!bucket) continue;
    bucket.knocks++;
    if (isAnswer(k.outcome)) bucket.answers++;
    total++;
  }
  if (total < Math.max(1, minKnocks)) return null;

  let best: LearnedBucket | null = null;
  for (const b of Object.values(buckets)) {
    b.mean = answerProbability(b);
    if (!best || b.mean > best.mean + 1e-12 || (Math.abs(b.mean - best.mean) <= 1e-12 && b.isPrior && !best.isPrior)) best = b;
  }
  if (!best) return null;
  const window: TimeWindow = { kind: "range", days: best.days, start: best.start, end: best.end };
  const dayWord = best.days === "weekdays" ? "weekday" : "weekend";
  const reason =
    best.knocks > 0
      ? `Learned from ${total} knocks: ${dayWord} ${formatHourRange(best.start, best.end)} answered ${best.answers} of ${best.knocks} (${approxPercent(best.mean)} expected).`
      : `Learned from ${total} knocks: nothing beat the area prior yet (${dayWord} ${formatHourRange(best.start, best.end)}).`;
  return { window, reason, knocks: total, best, buckets };
}

/** The learned bucket a slot falls in (for P(answer) in the score); null when outside knocking hours. */
export function learnedBucketAt(learned: Pick<LearnedWindow, "buckets">, slot: { weekday: number; hour: number }): LearnedBucket | null {
  const start = bucketStartOf(slot.hour);
  if (start < 0) return null;
  return learned.buckets[bucketKey(dayKindOf(slot.weekday), start)] ?? null;
}

// ---------- Resolution ----------

export type ResolveInput = {
  parcel: Pick<Parcel, "callback_window" | "home_pattern" | "do_not_knock">;
  blockGroup?: Pick<BlockGroup, "prior_window"> | null;
  learned?: LearnedWindow | null;
  settings: Pick<CanvassSettings, "learned_min_knocks">;
};

const CREW_WINDOWS: Record<Exclude<HomePattern, "unknown">, { window: TimeWindow; label: string }> = {
  home_weekdays: { window: { kind: "range", days: "weekdays", start: 9, end: 17 }, label: "Home weekdays (crew)" },
  evenings_only: { window: { kind: "range", days: "weekdays", start: 17, end: 20 }, label: "Weekday evenings (crew)" },
  weekends_only: { window: { kind: "range", days: "weekends", start: 10, end: 16 }, label: "Weekends (crew)" },
};

/** Homeowner → crew tag → learned (once it has enough knocks) → ACS prior → default. */
export function resolveWindow({ parcel, blockGroup, learned, settings }: ResolveInput): WindowResult {
  if (parcel.do_not_knock) {
    return { window: { kind: "anytime", days: "any" }, label: "Do not knock", source: "none", reason: "Marked do not knock." };
  }

  const stated = parcel.callback_window?.trim();
  if (stated) {
    const s = parseStatedWindow(stated);
    return {
      window: s.window,
      label: s.label,
      source: "homeowner",
      reason: s.parsed ? `Homeowner said: "${stated}"` : `Homeowner said: "${stated}" (could not read a time from it)`,
    };
  }

  if (parcel.home_pattern && parcel.home_pattern !== "unknown") {
    const crew = CREW_WINDOWS[parcel.home_pattern];
    return { window: crew.window, label: crew.label, source: "crew", reason: `Crew observed: ${parcel.home_pattern.replace(/_/g, " ")}.` };
  }

  if (learned && learned.knocks >= settings.learned_min_knocks) {
    return { window: learned.window, label: formatWindow(learned.window), source: "learned", reason: learned.reason };
  }

  const prior = blockGroup?.prior_window ?? null;
  if (prior && priorHasData(prior)) {
    return {
      window: prior.window,
      label: prior.daytimeFriendly ? "Anytime weekdays (daytime OK)" : formatWindow(prior.window),
      source: "acs",
      reason: prior.reason,
    };
  }

  return { window: { ...DEFAULT_WINDOW }, label: `${formatWindow(DEFAULT_WINDOW, "")} (default)`, source: "none", reason: NO_DATA_REASON };
}
