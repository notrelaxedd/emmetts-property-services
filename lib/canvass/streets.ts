/**
 * Street-level helpers for the Hangers page: join the street list (from parcels) with hanger conversions, pick the
 * block group a new code belongs to, and the copy printed on a hanger. Pure (no next/* or db imports).
 */
import type { ServiceKey } from "./types";
import type { HangerConversion } from "./hangers";
import type { SeasonFocus } from "./season";
import type { StreetRow } from "./views";

export type StreetHangerRow = StreetRow & {
  /** Unique scans across every code ever issued for the street. */
  scans: number;
  bookings: number;
  /** bookings ÷ scans; null until someone scans. */
  rate: number | null;
};

export type StreetTotals = { streets: number; parcels: number; withCode: number; scans: number; bookings: number; rate: number | null };

const streetKey = (s: string) => s.trim().toUpperCase();

/** One row per street with its scans / bookings summed over every code issued for it. Sorted by street. */
export function streetsWithConversions(streets: readonly StreetRow[], conversions: readonly HangerConversion[]): StreetHangerRow[] {
  const byStreet = new Map<string, { scans: number; bookings: number }>();
  for (const c of conversions) {
    const key = streetKey(c.street);
    const acc = byStreet.get(key) ?? { scans: 0, bookings: 0 };
    acc.scans += c.scans;
    acc.bookings += c.bookings;
    byStreet.set(key, acc);
  }
  return streets
    .map((s) => {
      const c = byStreet.get(streetKey(s.street)) ?? { scans: 0, bookings: 0 };
      return { ...s, scans: c.scans, bookings: c.bookings, rate: c.scans > 0 ? c.bookings / c.scans : null };
    })
    .sort((a, b) => a.street.localeCompare(b.street));
}

/** Totals line under the streets table. */
export function streetTotals(rows: readonly StreetHangerRow[]): StreetTotals {
  const t = { streets: rows.length, parcels: 0, withCode: 0, scans: 0, bookings: 0 };
  for (const r of rows) {
    t.parcels += r.parcels;
    if (r.code) t.withCode++;
    t.scans += r.scans;
    t.bookings += r.bookings;
  }
  return { ...t, rate: t.scans > 0 ? t.bookings / t.scans : null };
}

/** The block group most of a street's parcels sit in (ties → first seen); null when none is assigned. */
export function mostCommonGeoid(rows: readonly { block_group_geoid: string | null }[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestN = 0;
  for (const r of rows) {
    if (!r.block_group_geoid) continue;
    const n = (counts.get(r.block_group_geoid) ?? 0) + 1;
    counts.set(r.block_group_geoid, n);
    if (n > bestN) {
      best = r.block_group_geoid;
      bestN = n;
    }
  }
  return best;
}

// ---------- Hanger copy ----------

export type HangerCopy = {
  headline: string;
  /** The season offer: the owner's text when set, else the season default. */
  offer: string;
  /** Three short pitch lines. */
  bullets: [string, string, string];
};

const HEADLINES: Record<ServiceKey, string> = {
  mow: "Lawn care on your street",
  edge: "Clean edges on your street",
  leaf_cleanup: "Leaf cleanup on your street",
  gutters: "Gutter cleaning on your street",
  snow: "Snow removal on your street",
};

const BULLETS: Record<ServiceKey, [string, string, string]> = {
  mow: ["Weekly mowing and edging", "Same crew, same day each week", "No contract, cancel any time"],
  edge: ["Crisp lines on drives and walks", "Add it to any mow", "Quick, tidy, no mess left behind"],
  leaf_cleanup: ["Lawn and beds cleared of leaves", "Gutters cleared on request", "Done before the first snow"],
  gutters: ["Gutters cleared and flushed", "Downspouts checked", "Photos of the finished job"],
  snow: ["Season rate for driveway and walks", "Cleared before you leave for work", "Early pricing on spring mowing"],
};

/** What gets printed on the hanger for this season. Blank / whitespace offer text falls back to the default. */
export function hangerCopy(season: Pick<SeasonFocus, "service" | "offer">, offerText: string | null | undefined): HangerCopy {
  const custom = (offerText ?? "").trim();
  return {
    headline: HEADLINES[season.service] ?? HEADLINES.mow,
    offer: custom || season.offer,
    bullets: BULLETS[season.service] ?? BULLETS.mow,
  };
}
