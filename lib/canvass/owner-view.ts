/**
 * Pure helpers for the owner's Canvass home and parcel pages: search-param parsing for the default filters, the
 * Top 25 selection, and a few labels. No React, no next/*, no db.
 */
export const TOP_N = 25;

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type HomeParams = {
  /** The three default filters; each is ON unless its param is "0". */
  hideDnk: boolean;
  hideRecent: boolean;
  singleFamily: boolean;
};

/** `?dnk=&recent=&sf=` → typed params. Each filter is on unless its param is "0"; anything else (old `date` / `start` links too) is ignored. */
export function parseHomeParams(sp: SearchParams): HomeParams {
  return {
    hideDnk: first(sp.dnk) !== "0",
    hideRecent: first(sp.recent) !== "0",
    singleFamily: first(sp.sf) !== "0",
  };
}

export type TopRow = {
  id: string;
  scorePoints: number;
  /** The lawn factor (0..3), the tie-break between equal points. */
  scoreBreakdown: { lawn: number };
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

/** The rows that pass the default filters, best first: points, then the bigger lawn tier, then address. */
export function filterRows<T extends TopRow>(rows: readonly T[], o: Omit<TopOptions, "limit">): T[] {
  const cutoff = o.now.getTime() - Math.max(0, o.recencyDays) * 86_400_000;
  return rows
    .filter((r) => {
      if (o.hideDnk && r.do_not_knock) return false;
      if (o.hideRecent && r.lastKnockAt && o.recencyDays > 0 && new Date(r.lastKnockAt).getTime() >= cutoff) return false;
      if (o.singleFamily && !o.singleFamilyIds.has(r.id)) return false;
      return true;
    })
    .sort((a, b) => b.scorePoints - a.scorePoints || b.scoreBreakdown.lawn - a.scoreBreakdown.lawn || a.fullAddress.localeCompare(b.fullAddress));
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
