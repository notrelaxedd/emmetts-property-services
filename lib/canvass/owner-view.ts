/**
 * Pure helpers for the owner's Canvass home and parcel pages: search-param parsing for the slot picker and the
 * default filters, the Top 25 selection, the area banner, and a few labels. No React, no next/*, no db.
 */
import type { Light } from "./lights";
import { clockLabel } from "./lights";
import { localDate, localTime, weekdayOf } from "../scheduler/time";

export const TOP_N = 25;

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LIGHT_ORDER: Record<Light, number> = { green: 0, yellow: 1, red: 2 };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type HomeParams = {
  /** The chosen slot ("YYYY-MM-DD", "HH:MM"); null date or start means "now". */
  date: string | null;
  start: string | null;
  end: string | null;
  /** The three default filters; each is ON unless its param is "0". */
  hideDnk: boolean;
  hideRecent: boolean;
  singleFamily: boolean;
};

/** `?date=&start=&end=&dnk=&recent=&sf=` → typed params. Junk values fall back to "now" / defaults. */
export function parseHomeParams(sp: SearchParams): HomeParams {
  const date = first(sp.date);
  const start = first(sp.start);
  const end = first(sp.end);
  const validSlot = !!date && DATE_RE.test(date) && !!start && TIME_RE.test(start);
  return {
    date: validSlot ? date : null,
    start: validSlot ? start : null,
    end: validSlot && end && TIME_RE.test(end) ? end : null,
    hideDnk: first(sp.dnk) !== "0",
    hideRecent: first(sp.recent) !== "0",
    singleFamily: first(sp.sf) !== "0",
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The picker's default: now rounded down to the hour, for two hours (Ohio time). */
export function defaultSlot(now: Date): { date: string; start: string; end: string } {
  const hour = Number(localTime(now).slice(0, 2));
  const end = hour + 2 > 23 ? "23:59" : `${pad(hour + 2)}:00`;
  return { date: localDate(now), start: `${pad(hour)}:00`, end };
}

/** "Sat 4pm" for a local date + "HH:MM". */
export function slotLabel(date: string, start: string): string {
  const [h, m] = start.split(":").map(Number);
  return `${DAY_SHORT[weekdayOf(date)]} ${clockLabel(h + m / 60)}`;
}

export type AreaBanner = { emoji: string; text: string; light: Light | null };

/** The page-level knock-now banner: "Good time to knock now", or "... Sat 4pm" for a chosen slot. */
export function areaBanner(light: Light | null, slot: string | null): AreaBanner {
  const when = slot ?? "now";
  if (light === "green") return { emoji: "🟢", text: `Good time to knock ${when}`, light };
  if (light === "yellow") return { emoji: "🟡", text: `Maybe a good time to knock ${when}`, light };
  if (light === "red") return { emoji: "🔴", text: `Most doors probably not home ${when}`, light };
  return { emoji: "⚪", text: "No houses to judge yet", light: null };
}

export type TopRow = {
  id: string;
  scorePoints: number;
  light: Light;
  fullAddress: string;
  do_not_knock: boolean;
  lastKnockAt: string | null;
};

export type TopOptions = {
  hideDnk: boolean;
  hideRecent: boolean;
  /** Skip houses knocked within this many days (settings.recency_days). */
  recencyDays: number;
  singleFamily: boolean;
  /** Ids of houses whose land use counts as residential (county prefixes from Settings). */
  singleFamilyIds: ReadonlySet<string>;
  now: Date;
  limit?: number;
};

/** The rows that pass the default filters, best first: points, then green before yellow before red, then address. */
export function filterRows<T extends TopRow>(rows: readonly T[], o: Omit<TopOptions, "limit">): T[] {
  const cutoff = o.now.getTime() - Math.max(0, o.recencyDays) * 86_400_000;
  return rows
    .filter((r) => {
      if (o.hideDnk && r.do_not_knock) return false;
      if (o.hideRecent && r.lastKnockAt && o.recencyDays > 0 && new Date(r.lastKnockAt).getTime() >= cutoff) return false;
      if (o.singleFamily && !o.singleFamilyIds.has(r.id)) return false;
      return true;
    })
    .sort((a, b) => b.scorePoints - a.scorePoints || LIGHT_ORDER[a.light] - LIGHT_ORDER[b.light] || a.fullAddress.localeCompare(b.fullAddress));
}

/** The Top N (default 25) after the filters, plus how many more passed them. */
export function topList<T extends TopRow>(rows: readonly T[], o: TopOptions): { top: T[]; moreMatching: number } {
  const all = filterRows(rows, o);
  const limit = o.limit ?? TOP_N;
  return { top: all.slice(0, limit), moreMatching: Math.max(0, all.length - limit) };
}

/** "Owner-occupied" | "Rental" | "Unknown". An entity owner or a not-occupied flag is a rental (as in the score). */
export function occupancyLabel(ownerOccupied: boolean | null, ownerIsEntity: boolean): "Owner-occupied" | "Rental" | "Unknown" {
  if (ownerIsEntity || ownerOccupied === false) return "Rental";
  return ownerOccupied === true ? "Owner-occupied" : "Unknown";
}

/** "$74,200" or "not available" (Census block-group median, never this household's own income). */
export function incomeLabel(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : "not available";
}
