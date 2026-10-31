/**
 * Pure helpers for the Settings pricing grids: a TierTable (5 services x small / medium / large / xl) to editable
 * strings and back. A blank cell is `null` ("owner to fill in" for a price, "unknown" for minutes). No React, no db.
 */
import { SERVICE_KEYS, SERVICE_LABELS, TIER_KEYS, TIER_LABELS } from "./types";
import type { ScoreWeights, ServiceKey, TierBounds, TierKey, TierTable } from "./types";

export type TierDraft = Record<ServiceKey, Record<TierKey, string>>;

/** The placeholder a blank price cell shows; XL is "Quote on site" instead (blank XL is the on-site quote). */
export const PRICE_PLACEHOLDER = "[OWNER_TO_FILL]";
export const XL_PRICE_PLACEHOLDER = "Quote on site";

export const pricePlaceholder = (tier: TierKey): string => (tier === "xl" ? XL_PRICE_PLACEHOLDER : PRICE_PLACEHOLDER);

/** Stored table → input strings (null → ""). */
export function tierDraftFrom(table: TierTable): TierDraft {
  const out = {} as TierDraft;
  for (const s of SERVICE_KEYS) {
    const row = {} as Record<TierKey, string>;
    for (const t of TIER_KEYS) {
      const v = table[s]?.[t];
      row[t] = typeof v === "number" && Number.isFinite(v) ? String(v) : "";
    }
    out[s] = row;
  }
  return out;
}

export type ParsedTable = { ok: true; table: TierTable } | { ok: false; error: string };

/** Input strings → a full table. Blank → null; anything else must be a number >= 0 (and <= 100000). */
export function parseTierDraft(draft: TierDraft, what: string): ParsedTable {
  const table = {} as TierTable;
  for (const s of SERVICE_KEYS) {
    const row = {} as Record<TierKey, number | null>;
    for (const t of TIER_KEYS) {
      const text = (draft[s]?.[t] ?? "").trim();
      if (text === "") {
        row[t] = null;
        continue;
      }
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0 || n > 100_000) {
        return { ok: false, error: `${SERVICE_LABELS[s]} ${TIER_LABELS[t]} ${what} must be a number of 0 or more` };
      }
      row[t] = n;
    }
    table[s] = row;
  }
  return { ok: true, table };
}

export type BoundsDraft = { small_max: string; medium_max: string; large_max: string };

export const boundsDraftFrom = (b: TierBounds): BoundsDraft => ({
  small_max: String(b.small_max),
  medium_max: String(b.medium_max),
  large_max: String(b.large_max),
});

/** Three lot-size cut-offs (turf sqft) that must be positive and strictly ascending. */
export function parseBounds(d: BoundsDraft): { ok: true; bounds: TierBounds } | { ok: false; error: string } {
  const small = Number(d.small_max.trim());
  const medium = Number(d.medium_max.trim());
  const large = Number(d.large_max.trim());
  if (![small, medium, large].every((n) => d.small_max.trim() !== "" && Number.isFinite(n) && n > 0)) {
    return { ok: false, error: "Lot size bounds must be numbers above 0" };
  }
  if (!(small < medium && medium < large)) return { ok: false, error: "Lot size bounds must go up: small, then medium, then large" };
  return { ok: true, bounds: { small_max: small, medium_max: medium, large_max: large } };
}

export type WeightsDraft = Record<keyof ScoreWeights, string>;

export const weightsDraftFrom = (w: ScoreWeights): WeightsDraft => ({
  time: String(w.time),
  lawn: String(w.lawn),
  customer: String(w.customer),
  owner: String(w.owner),
});

/** Four score multipliers, each 0 to 10 (0 turns a factor off). */
export function parseWeights(d: WeightsDraft): { ok: true; weights: ScoreWeights } | { ok: false; error: string } {
  const out = {} as ScoreWeights;
  for (const k of Object.keys(d) as (keyof ScoreWeights)[]) {
    const text = d[k].trim();
    const n = Number(text);
    if (text === "" || !Number.isFinite(n) || n < 0 || n > 10) return { ok: false, error: `Score weight for ${k} must be between 0 and 10` };
    out[k] = n;
  }
  return { ok: true, weights: out };
}

/** The tier a turf size falls in for the bounds, spelled out for the hint under the bounds fields. */
export function boundsSummary(b: TierBounds): string {
  const f = (n: number) => n.toLocaleString("en-US");
  return `Small up to ${f(b.small_max)}, medium up to ${f(b.medium_max)}, large up to ${f(b.large_max)}, XL above`;
}
