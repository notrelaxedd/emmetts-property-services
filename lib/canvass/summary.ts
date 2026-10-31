/**
 * The nightly canvass summary: build an aggregate digest of one day's knocks (America/New_York), have lib/ai/claude.ts
 * write the owner's morning summary, store it in `canvass_summaries`. The digest holds counts by outcome, street,
 * knocker, pitch and time bucket plus the weather and hanger scans; no notes, no callback text, nothing about a
 * resident. `digestFromRows` is pure and unit-tested; `buildCanvassDigest` / `runNightlySummary` feed it from the db.
 */
import { summarizeCanvassDay } from "../ai/claude";
import { resolveModel } from "../ai/client";
import type { AiCallOptions } from "../ai/claude";
import type { CanvassSummary, Knock, KnockOutcome } from "../db/types";
import { check } from "../ops/types";
import type { Db } from "../ops/types";
import { addDays, localDate, zonedToUtc } from "../scheduler/time";
import { loadParcelViews } from "./load";
import { currentSeasonFocus } from "./season";
import { getCanvassSettings } from "./settings";
import type { CanvassSummaryContent, WindowSource } from "./types";
import { CANVASS_TZ, bucketOf, formatHourRange, isAnswer } from "./windows";

export const SUMMARY_TZ = CANVASS_TZ;

const KNOCK_OUTCOMES: readonly KnockOutcome[] = ["no_answer", "not_interested", "quote_given", "booked", "call_back", "no_soliciting", "do_not_return", "has_service"];

export type DigestGroup = { name: string; knocks: number; answers: number; quotes: number; booked: number; callbacks: number };
export type DigestStreet = DigestGroup & { doNotKnock: number; window: string | null };

/** What the model sees. Aggregate only. */
export type CanvassDigest = {
  /** "YYYY-MM-DD" */
  for_date: string;
  /** "Thursday" */
  weekday: string;
  /** Season focus label, e.g. "Leaf cleanup". */
  season: string;
  totals: { knocks: number; answers: number; quotes: number; booked: number; callbacks: number; doNotKnock: number; answerRate: number | null; closeRate: number | null };
  byOutcome: Record<KnockOutcome, number>;
  byStreet: DigestStreet[];
  byKnocker: DigestGroup[];
  byPitch: DigestGroup[];
  /** "Weekdays 4–6pm" style buckets with knocks / answers. */
  byHour: { bucket: string; knocks: number; answers: number }[];
  /** Distinct weather at the knocks, e.g. "52°F, Overcast". */
  weather: string[];
  hangerScans: number;
};

export type DigestKnockRow = Pick<Knock, "knocked_at" | "outcome" | "knocker_id" | "pitch_id" | "weather"> & { street: string };

export type DigestInput = {
  forDate: string;
  knocks: readonly DigestKnockRow[];
  knockerNames: ReadonlyMap<string, string>;
  pitchNames: ReadonlyMap<string, string>;
  /** Street → the planner's window label for most of its houses. */
  windowsByStreet?: ReadonlyMap<string, string>;
  hangerScans?: number;
  season?: string;
};

const ratio = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

const emptyGroup = (name: string): DigestGroup => ({ name, knocks: 0, answers: 0, quotes: 0, booked: 0, callbacks: 0 });

function tally(group: DigestGroup, outcome: KnockOutcome) {
  group.knocks++;
  if (isAnswer(outcome)) group.answers++;
  if (outcome === "quote_given") group.quotes++;
  if (outcome === "booked") group.booked++;
  if (outcome === "call_back") group.callbacks++;
}

const byKnocksDesc = <T extends DigestGroup>(a: T, b: T) => b.knocks - a.knocks || b.answers - a.answers || a.name.localeCompare(b.name);

/** "2026-10-29" → "Thursday" (calendar date, no timezone involved). */
export function weekdayName(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/** The 2-hour bucket a knock fell in, labelled "Weekdays 4–6pm" (or "Weekends …"; "Off hours" outside 6am–10pm). */
export function knockBucketLabel(knockedAt: string, timezone = SUMMARY_TZ): string {
  const b = bucketOf(knockedAt, timezone);
  if (b.start < 0) return "Off hours";
  return `${b.days === "weekends" ? "Weekends" : "Weekdays"} ${formatHourRange(b.start, b.start + 2)}`;
}

/** "52°F, Overcast" from a knock's stored weather; null when nothing was recorded. */
export function weatherLabel(weather: Knock["weather"]): string | null {
  if (!weather) return null;
  const parts: string[] = [];
  if (weather.temp_f !== null && Number.isFinite(weather.temp_f)) parts.push(`${Math.round(weather.temp_f)}°F`);
  if (weather.label) parts.push(weather.label);
  if (weather.precip_in !== null && weather.precip_in > 0) parts.push(`${weather.precip_in.toFixed(2)} in precip`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Pure aggregation of one day's knock rows into the digest the model reads. */
export function digestFromRows(input: DigestInput): CanvassDigest {
  const byOutcome = Object.fromEntries(KNOCK_OUTCOMES.map((o) => [o, 0])) as Record<KnockOutcome, number>;
  const totals = emptyGroup("total");
  let doNotKnock = 0;
  const streets = new Map<string, DigestStreet>();
  const knockers = new Map<string, DigestGroup>();
  const pitches = new Map<string, DigestGroup>();
  const hours = new Map<string, { bucket: string; knocks: number; answers: number; order: number }>();
  const weather = new Map<string, number>();

  for (const k of input.knocks) {
    byOutcome[k.outcome] = (byOutcome[k.outcome] ?? 0) + 1;
    tally(totals, k.outcome);
    const dnk = k.outcome === "no_soliciting" || k.outcome === "do_not_return";
    if (dnk) doNotKnock++;

    const streetName = k.street.trim().toUpperCase() || "UNKNOWN STREET";
    const street = streets.get(streetName) ?? { ...emptyGroup(streetName), doNotKnock: 0, window: input.windowsByStreet?.get(streetName) ?? null };
    tally(street, k.outcome);
    if (dnk) street.doNotKnock++;
    streets.set(streetName, street);

    const knockerName = input.knockerNames.get(k.knocker_id) ?? "Crew";
    const knocker = knockers.get(knockerName) ?? emptyGroup(knockerName);
    tally(knocker, k.outcome);
    knockers.set(knockerName, knocker);

    const pitchName = k.pitch_id ? (input.pitchNames.get(k.pitch_id) ?? "Unknown pitch") : "No pitch";
    const pitch = pitches.get(pitchName) ?? emptyGroup(pitchName);
    tally(pitch, k.outcome);
    pitches.set(pitchName, pitch);

    const b = bucketOf(k.knocked_at, SUMMARY_TZ);
    const bucket = knockBucketLabel(k.knocked_at);
    const hour = hours.get(bucket) ?? { bucket, knocks: 0, answers: 0, order: (b.days === "weekends" ? 100 : 0) + (b.start < 0 ? 99 : b.start) };
    hour.knocks++;
    if (isAnswer(k.outcome)) hour.answers++;
    hours.set(bucket, hour);

    const w = weatherLabel(k.weather);
    if (w) weather.set(w, (weather.get(w) ?? 0) + 1);
  }

  return {
    for_date: input.forDate,
    weekday: weekdayName(input.forDate),
    season: input.season ?? "",
    totals: {
      knocks: totals.knocks,
      answers: totals.answers,
      quotes: totals.quotes,
      booked: totals.booked,
      callbacks: totals.callbacks,
      doNotKnock,
      answerRate: ratio(totals.answers, totals.knocks),
      closeRate: ratio(totals.booked, totals.answers),
    },
    byOutcome,
    byStreet: Array.from(streets.values()).sort(byKnocksDesc),
    byKnocker: Array.from(knockers.values()).sort(byKnocksDesc),
    byPitch: Array.from(pitches.values()).sort(byKnocksDesc),
    byHour: Array.from(hours.values())
      .sort((a, b) => a.order - b.order)
      .map(({ bucket, knocks, answers }) => ({ bucket, knocks, answers })),
    weather: Array.from(weather.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label]) => label),
    hangerScans: input.hangerScans ?? 0,
  };
}

/** The minimal stored summary for a day without knocks (no model call). */
export function emptySummary(forDate: string): CanvassSummaryContent {
  return {
    headline: `No knocks on ${forDate}`,
    highlights: [],
    best_streets: [],
    worst_streets: [],
    knocker_notes: [],
    pitch_notes: [],
    tomorrow: [],
  };
}

/** Yesterday's local calendar date in America/New_York. */
export function yesterdayLocal(now: Date = new Date()): string {
  return addDays(localDate(now), -1);
}

/** UTC bounds [start, end) of a local calendar date. */
export function dayBounds(forDate: string): { start: string; end: string } {
  return { start: zonedToUtc(forDate, "00:00").toISOString(), end: zonedToUtc(addDays(forDate, 1), "00:00").toISOString() };
}

/**
 * Most common plain-English window per street among the given parcel views ("Weekdays after 4pm, Saturdays all day").
 * Only area-level windows count (learned, ACS prior, default): a homeowner's words are verbatim and a crew tag is about
 * one house, and neither may reach the model.
 */
export function windowsByStreet(
  parcels: readonly { street: string; plain: { text: string }; window: { source?: WindowSource }; do_not_knock: boolean }[],
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const p of parcels) {
    if (p.do_not_knock || p.window.source === "homeowner" || p.window.source === "crew") continue;
    const street = p.street.trim().toUpperCase();
    const inner = counts.get(street) ?? new Map<string, number>();
    inner.set(p.plain.text, (inner.get(p.plain.text) ?? 0) + 1);
    counts.set(street, inner);
  }
  const out = new Map<string, string>();
  counts.forEach((inner, street) => {
    let best: string | null = null;
    let bestN = 0;
    inner.forEach((n, label) => {
      if (n > bestN) {
        best = label;
        bestN = n;
      }
    });
    if (best) out.set(street, best);
  });
  return out;
}

/** The digest for one local day from the database. */
export async function buildCanvassDigest(db: Db, forDate: string): Promise<CanvassDigest> {
  const { start, end } = dayBounds(forDate);
  const knocks =
    check(
      await db
        .from("knocks")
        .select("parcel_id,knocked_at,outcome,knocker_id,pitch_id,weather")
        .gte("knocked_at", start)
        .lt("knocked_at", end)
        .order("knocked_at", { ascending: true })
        .limit(5000),
      "digest knocks",
    ) ?? [];
  const settings = await getCanvassSettings(db);
  const season = currentSeasonFocus(settings.season_map, zonedToUtc(forDate, "12:00")).label;
  if (knocks.length === 0) {
    return digestFromRows({ forDate, knocks: [], knockerNames: new Map(), pitchNames: new Map(), season });
  }

  const parcelIds = Array.from(new Set(knocks.map((k) => k.parcel_id)));
  const { parcels } = await loadParcelViews(db, { ids: parcelIds });
  const streetById = new Map(parcels.map((p) => [p.id, p.street]));

  const knockerIds = Array.from(new Set(knocks.map((k) => k.knocker_id)));
  const pitchIds = Array.from(new Set(knocks.map((k) => k.pitch_id).filter((p): p is string => !!p)));
  const [profiles, pitches, scans] = await Promise.all([
    db.from("profiles").select("id,name").in("id", knockerIds),
    pitchIds.length > 0 ? db.from("pitches").select("id,name").in("id", pitchIds) : Promise.resolve({ data: [], error: null }),
    db.from("hanger_events").select("id").eq("event", "scan").gte("created_at", start).lt("created_at", end).limit(5000),
  ]);

  return digestFromRows({
    forDate,
    knocks: knocks.map((k) => ({ ...k, street: streetById.get(k.parcel_id) ?? "" })),
    knockerNames: new Map((check(profiles, "digest knockers") ?? []).map((p) => [p.id, p.name])),
    pitchNames: new Map((check(pitches, "digest pitches") ?? []).map((p) => [p.id, p.name])),
    windowsByStreet: windowsByStreet(parcels),
    hangerScans: (check(scans, "digest scans") ?? []).length,
    season,
  });
}

export type NightlySummaryResult = {
  for_date: string;
  knocks: number;
  /** False when the day had no knocks (the minimal summary was stored without a model call). */
  usedModel: boolean;
  summary: CanvassSummaryContent;
};

/** Store (insert or replace) the summary for a date. */
export async function storeCanvassSummary(db: Db, forDate: string, summary: CanvassSummaryContent, model: string | null): Promise<void> {
  const existing = check(await db.from("canvass_summaries").select("id").eq("for_date", forDate).limit(1), "canvass summary lookup") ?? [];
  const row: Partial<CanvassSummary> = { for_date: forDate, summary, model };
  if (existing[0]) check(await db.from("canvass_summaries").update(row).eq("id", existing[0].id), "update canvass summary");
  else check(await db.from("canvass_summaries").insert(row), "insert canvass summary");
}

/**
 * Build yesterday's (or `forDate`'s) digest, write the summary with the model when there were knocks (minimal
 * summary otherwise, no model call), and store it under the date (one row per day, replaced on re-run).
 */
export async function runNightlySummary(db: Db, forDate: string = yesterdayLocal(), opts: AiCallOptions = {}): Promise<NightlySummaryResult> {
  const digest = await buildCanvassDigest(db, forDate);
  if (digest.totals.knocks === 0) {
    const summary = emptySummary(forDate);
    await storeCanvassSummary(db, forDate, summary, null);
    return { for_date: forDate, knocks: 0, usedModel: false, summary };
  }
  const summary = await summarizeCanvassDay(db, digest, opts);
  await storeCanvassSummary(db, forDate, summary, resolveModel());
  return { for_date: forDate, knocks: digest.totals.knocks, usedModel: true, summary };
}
