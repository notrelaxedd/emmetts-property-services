/**
 * The single `canvass_settings` row (server-side; service-role client). JSON columns are merged over
 * their defaults so a partial blob written by an older build never breaks the planner.
 */
import { CANVASS_SETTINGS_ID } from "../db/types";
import type { CanvassSettings } from "../db/types";
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import {
  DEFAULT_PRICE_TIERS,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_SEASON_MAP,
  DEFAULT_TIER_BOUNDS,
  DEFAULT_TIER_MINUTES,
  PARCEL_FIELD_KEYS,
  SERVICE_KEYS,
  TIER_KEYS,
  emptyParcelFieldMap,
} from "./types";
import type {
  ParcelFieldMap,
  ParcelFieldMapPatch,
  ParcelFieldMapping,
  ScoreWeights,
  SeasonMap,
  ServiceKey,
  TierBounds,
  TierKey,
  TierTable,
} from "./types";

export { DEFAULT_PRICE_TIERS, DEFAULT_SCORE_WEIGHTS, DEFAULT_SEASON_MAP, DEFAULT_TIER_BOUNDS, DEFAULT_TIER_MINUTES };

/** A partial tier table: `{ mow: { medium: 45 } }` keeps every other cell; an explicit `null` clears a cell. */
export type TierTablePatch = { [S in ServiceKey]?: Partial<Record<TierKey, number | null>> };

export type CanvassSettingsPatch = Partial<
  Omit<
    CanvassSettings,
    | "id"
    | "created_at"
    | "updated_at"
    | "price_tiers"
    | "tier_minutes"
    | "tier_bounds"
    | "score_weights"
    | "season_map"
    | "parcel_field_map"
  >
> & {
  /** Per-cell partial: `{ mow: { medium: 45 } }` keeps the other prices; `null` clears a price ("owner to fill in"). */
  price_tiers?: TierTablePatch;
  /** Per-cell partial, same shape as `price_tiers`: crew minutes. */
  tier_minutes?: TierTablePatch;
  tier_bounds?: Partial<TierBounds>;
  score_weights?: Partial<ScoreWeights>;
  /** Per-month partial: `{ "9": "mow" }` keeps the other months. */
  season_map?: Partial<SeasonMap>;
  /** Per-key partial: an entry replaces that key's mapping; the other keys are kept. */
  parcel_field_map?: ParcelFieldMapPatch;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isService = (v: unknown): v is ServiceKey => typeof v === "string" && (SERVICE_KEYS as string[]).includes(v);

/**
 * Merge a stored tier table (prices or minutes) with a patch over the defaults, cell by cell. A patch cell wins over
 * the stored one; an explicit `null` is a real value (cleared). Anything that is not null / a finite number >= 0
 * falls back to the next layer, so a malformed blob never breaks the planner.
 */
function mergeTierTable(defaults: TierTable, stored: unknown, over?: TierTablePatch): TierTable {
  const base = isObject(stored) ? stored : {};
  const patch = (over ?? {}) as Record<string, unknown>;
  const valid = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  const out = {} as TierTable;
  for (const service of SERVICE_KEYS) {
    const b = isObject(base[service]) ? (base[service] as Record<string, unknown>) : {};
    const p = isObject(patch[service]) ? (patch[service] as Record<string, unknown>) : {};
    const row = {} as Record<TierKey, number | null>;
    for (const tier of TIER_KEYS) {
      row[tier] = valid(p[tier]) ? p[tier] : valid(b[tier]) ? b[tier] : defaults[service][tier];
    }
    out[service] = row;
  }
  return out;
}

/** Merge a stored `price_tiers` blob over the defaults (`null` = not filled in). */
export const mergePriceTiers = (stored: unknown, over?: TierTablePatch): TierTable =>
  mergeTierTable(DEFAULT_PRICE_TIERS, stored, over);

/** Merge a stored `tier_minutes` blob over the defaults (`null` = unknown). */
export const mergeTierMinutes = (stored: unknown, over?: TierTablePatch): TierTable =>
  mergeTierTable(DEFAULT_TIER_MINUTES, stored, over);

/**
 * Merge stored `tier_bounds` with a patch. Each bound must be a finite number > 0 and the three must be strictly
 * ascending; a patch that breaks the order is ignored (the stored bounds win), and stored junk falls back to the
 * defaults.
 */
export function mergeTierBounds(stored: unknown, over?: Partial<TierBounds>): TierBounds {
  const keys = ["small_max", "medium_max", "large_max"] as const;
  const pick = (src: unknown, fallback: TierBounds): TierBounds => {
    const o = isObject(src) ? src : {};
    const out = { ...fallback };
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  };
  const ascending = (b: TierBounds) => b.small_max < b.medium_max && b.medium_max < b.large_max;
  let current = pick(stored, DEFAULT_TIER_BOUNDS);
  if (!ascending(current)) current = { ...DEFAULT_TIER_BOUNDS };
  const next = pick(over, current);
  return ascending(next) ? next : current;
}

/** Merge stored `score_weights` over the defaults. Weights are finite numbers in 0..10 (0 switches a factor off). */
export function mergeScoreWeights(stored: unknown, over?: Partial<ScoreWeights>): ScoreWeights {
  const base = isObject(stored) ? stored : {};
  const patch = (over ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SCORE_WEIGHTS };
  for (const k of Object.keys(DEFAULT_SCORE_WEIGHTS) as (keyof ScoreWeights)[]) {
    for (const v of [patch[k], base[k]]) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10) {
        out[k] = v;
        break;
      }
    }
  }
  return out;
}

/** Merge a stored season_map over the defaults. Unknown services fall back to the default for that month. */
export function mergeSeasonMap(stored: unknown, over?: Partial<SeasonMap>): SeasonMap {
  const base = isObject(stored) ? stored : {};
  const patch = (over ?? {}) as Record<string, unknown>;
  const out: SeasonMap = { ...DEFAULT_SEASON_MAP };
  for (const month of Object.keys(DEFAULT_SEASON_MAP)) {
    const v = patch[month] ?? base[month];
    if (isService(v)) out[month] = v;
  }
  return out;
}

const isMapping = (v: unknown): v is ParcelFieldMapping =>
  isObject(v) &&
  (v.field === null || typeof v.field === "string") &&
  (v.source === "auto" || v.source === "manual" || v.source === "missing") &&
  Array.isArray(v.candidates);

/**
 * Merge a stored parcel_field_map (object or garbage) with a patch, key by key. Every FieldKey is present in the
 * result (unresolved keys read `{ field: null, source: "missing", candidates: [] }`); malformed entries are dropped.
 * The layer metadata (`layer_fields`, `layer_name`, `fetched_at`) is kept from the patch, else from the stored map.
 */
export function mergeParcelFieldMap(stored: unknown, over?: ParcelFieldMapPatch): ParcelFieldMap {
  const base = (isObject(stored) ? stored : {}) as Record<string, unknown>;
  const patch = (over ?? {}) as Record<string, unknown>;
  const out = emptyParcelFieldMap();
  for (const key of PARCEL_FIELD_KEYS) {
    const v = key in patch ? patch[key] : base[key];
    if (isMapping(v)) out[key] = { field: v.field, source: v.source, candidates: v.candidates.filter((c) => typeof c === "string") };
  }
  const layerFields = patch.layer_fields ?? base.layer_fields;
  if (Array.isArray(layerFields)) out.layer_fields = layerFields as ParcelFieldMap["layer_fields"];
  const layerName = patch.layer_name ?? base.layer_name;
  if (typeof layerName === "string") out.layer_name = layerName;
  const fetchedAt = patch.fetched_at ?? base.fetched_at;
  if (typeof fetchedAt === "string") out.fetched_at = fetchedAt;
  return out;
}

function normalize(row: CanvassSettings): CanvassSettings {
  return {
    ...row,
    price_tiers: mergePriceTiers(row.price_tiers),
    tier_bounds: mergeTierBounds(row.tier_bounds),
    tier_minutes: mergeTierMinutes(row.tier_minutes),
    score_weights: mergeScoreWeights(row.score_weights),
    season_map: mergeSeasonMap(row.season_map),
    parcel_field_map: mergeParcelFieldMap(row.parcel_field_map),
  };
}

/** Reads the single canvass_settings row with every JSON column merged over its defaults. */
export async function getCanvassSettings(db: Db): Promise<CanvassSettings> {
  const row = check(
    await db.from("canvass_settings").select("*").eq("id", CANVASS_SETTINGS_ID).maybeSingle(),
    "getCanvassSettings",
  );
  if (!row) throw new Error("getCanvassSettings: canvass_settings row is missing (migration 1800 not applied?)");
  return normalize(row);
}

/** Updates the canvass_settings row and returns it. JSON columns are merged, not replaced. */
export async function updateCanvassSettings(db: Db, patch: CanvassSettingsPatch): Promise<CanvassSettings> {
  const { price_tiers, tier_minutes, tier_bounds, score_weights, season_map, parcel_field_map, ...rest } = patch;
  const update: Partial<CanvassSettings> = { ...rest };
  if (price_tiers || tier_minutes || tier_bounds || score_weights || season_map || parcel_field_map) {
    const current = await getCanvassSettings(db);
    if (price_tiers) update.price_tiers = mergePriceTiers(current.price_tiers, price_tiers);
    if (tier_minutes) update.tier_minutes = mergeTierMinutes(current.tier_minutes, tier_minutes);
    if (tier_bounds) update.tier_bounds = mergeTierBounds(current.tier_bounds, tier_bounds);
    if (score_weights) update.score_weights = mergeScoreWeights(current.score_weights, score_weights);
    if (season_map) update.season_map = mergeSeasonMap(current.season_map, season_map);
    if (parcel_field_map) update.parcel_field_map = mergeParcelFieldMap(current.parcel_field_map, parcel_field_map);
  }
  if (Object.keys(update).length === 0) return getCanvassSettings(db);
  const row = one(
    await db.from("canvass_settings").update(update).eq("id", CANVASS_SETTINGS_ID).select("*").single(),
    "updateCanvassSettings",
  );
  return normalize(row);
}
