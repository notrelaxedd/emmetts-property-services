/**
 * Shared value types for the Canvass tab (door-to-door planning). Pure: no next/* or db imports.
 * JSON column shapes used by `lib/db/types.ts` live here too, so the database contract and the
 * planning logic agree on one definition.
 */

// ---------- Timing: ranges, never exact times ----------

export type WindowDays = "weekdays" | "weekends" | "any";

/**
 * A window to knock. `start`/`end` are hours (0–24, end exclusive) and always span at least a
 * 2-hour bucket. `anytime` means "any reasonable hour on those days".
 */
export type TimeWindow =
  | { kind: "range"; days: WindowDays; start: number; end: number }
  | { kind: "anytime"; days: WindowDays };

export type WindowSource = "homeowner" | "crew" | "learned" | "acs" | "none";

export type WindowResult = {
  window: TimeWindow;
  /** e.g. "Weekdays 4–6pm likely", "Anytime weekdays". */
  label: string;
  source: WindowSource;
  /** Shown on hover: why this window. */
  reason: string;
};

/** `block_groups.prior_window`: the day-one window from ACS aggregates. */
export type PriorWindow = {
  daytimeFriendly: boolean;
  window: TimeWindow;
  reason: string;
  pctNotInLf: number | null;
  pctNonworkingParent: number | null;
  /** Typical departure for work, decimal hours (7.5 = 7:30am). */
  typicalDepart: number | null;
  /** Typical one-way commute, minutes. */
  typicalCommute: number | null;
};

// ---------- County field map ----------

export const PARCEL_FIELD_KEYS = [
  "parcel_id",
  "owner",
  "site_address",
  "site_city",
  "site_zip",
  "mailing_address",
  "land_use",
  "acreage",
  "shape_area",
  "market_value",
  "year_built",
  "living_sqft",
  "stories",
  "footprint_sqft",
  "owner_occupied",
  "street",
] as const;
export type ParcelFieldKey = (typeof PARCEL_FIELD_KEYS)[number];

/** Keys the pull derives itself when the layer has no such field (`street` comes from the site address). */
export const DERIVED_FIELD_KEYS: readonly ParcelFieldKey[] = ["street"];

export type ParcelFieldMapping = {
  /** The layer field name used, or null when nothing matched. */
  field: string | null;
  source: "auto" | "manual" | "missing";
  /** Every layer field that looked like a candidate (for the Settings dropdown). */
  candidates: string[];
};

export type LayerFieldInfo = { name: string; type: string; alias: string };

type ParcelFieldMapMeta = {
  /** Every field the layer reports, so the owner can pick any of them. */
  layer_fields?: LayerFieldInfo[];
  layer_name?: string;
  fetched_at?: string;
};

/**
 * `canvass_settings.parcel_field_map`: discovered at runtime from the layer metadata, owner-editable. Every
 * FieldKey is present once it has been through `mergeParcelFieldMap` / `buildFieldMap` (an unresolved key is
 * `{ field: null, source: "missing", candidates: [] }`); the column default `{}` is a `ParcelFieldMapPatch`.
 */
export type ParcelFieldMap = Record<ParcelFieldKey, ParcelFieldMapping> & ParcelFieldMapMeta;

/** A partial map, as stored before the first county fetch or as an owner's per-key edit. */
export type ParcelFieldMapPatch = Partial<Record<ParcelFieldKey, ParcelFieldMapping>> & ParcelFieldMapMeta;

/** `{ field: null, source: "missing", candidates: [] }` for one key. */
export const missingFieldMapping = (): ParcelFieldMapping => ({ field: null, source: "missing", candidates: [] });

/** A map with every FieldKey unresolved (what the planner sees before the first "Refresh from county"). */
export function emptyParcelFieldMap(): ParcelFieldMap {
  const out = {} as ParcelFieldMap;
  for (const key of PARCEL_FIELD_KEYS) out[key] = missingFieldMapping();
  return out;
}

// ---------- Weather, pricing, season ----------

/** `knocks.weather` from Open-Meteo at the moment of the knock. */
export type KnockWeather = {
  temp_f: number | null;
  precip_in: number | null;
  /** WMO weather code. */
  code: number | null;
  label: string;
};

export type ServiceKey = "mow" | "edge" | "leaf_cleanup" | "gutters" | "snow";
export const SERVICE_KEYS: ServiceKey[] = ["mow", "edge", "leaf_cleanup", "gutters", "snow"];
export const SERVICE_LABELS: Record<ServiceKey, string> = {
  mow: "Mowing",
  edge: "Edging",
  leaf_cleanup: "Leaf cleanup",
  gutters: "Gutter cleaning",
  snow: "Snow removal",
};

/** Lot-size tier, cut by turf sqft (`TierBounds`). */
export type TierKey = "small" | "medium" | "large" | "xl";
export const TIER_KEYS: TierKey[] = ["small", "medium", "large", "xl"];
export const TIER_LABELS: Record<TierKey, string> = { small: "Small", medium: "Medium", large: "Large", xl: "XL" };

/**
 * `canvass_settings.price_tiers` (dollars per visit) and `tier_minutes` (crew minutes): service → tier → number.
 * null = not filled in (an xl price of null reads "Quote on site"; a null minutes value means unknown).
 */
export type TierTable = Record<ServiceKey, Record<TierKey, number | null>>;

/** `canvass_settings.tier_bounds`: small ≤ small_max < medium ≤ medium_max < large ≤ large_max < xl (turf sqft). */
export type TierBounds = { small_max: number; medium_max: number; large_max: number };

/** `canvass_settings.score_weights`: multipliers on the three simple-score factors (a stored `time` key is ignored). */
export type ScoreWeights = { lawn: number; customer: number; owner: number };

/** `canvass_settings.season_map`: month ("1".."12") → featured service. */
export type SeasonMap = Record<string, ServiceKey>;

// ---------- GeoJSON (just enough) ----------

export type Position = [number, number]; // [lng, lat]
export type GeoPolygon = { type: "Polygon"; coordinates: Position[][] };
export type GeoMultiPolygon = { type: "MultiPolygon"; coordinates: Position[][][] };
export type ParcelGeom = GeoPolygon | GeoMultiPolygon;
export type GeoFeature<G = ParcelGeom> = { type: "Feature"; geometry: G; properties: Record<string, unknown> | null };
export type GeoFeatureCollection<G = ParcelGeom> = { type: "FeatureCollection"; features: GeoFeature<G>[] };

/** One service's quote for one house (lib/canvass/quote.ts `quoteFor`). */
export type Quote = {
  service: ServiceKey;
  /** Null when the turf is unknown. */
  tier: TierKey | null;
  turfSqft: number | null;
  status: "priced" | "quote_on_site" | "unpriced" | "unknown_turf";
  /** Dollars, after the value-tier multiplier when enabled. */
  price: number | null;
  /** "$40" | "Quote on site" | "Owner to fill in" | "Lot size unknown" */
  label: string;
  /** crew_size × pay_rate × minutes / 60 when tier_minutes has a value. Owner pages only. */
  laborCost: number | null;
  /** price − laborCost. Owner pages only. */
  profit: number | null;
  /** profit !== null && profit < 0. Owner pages only. */
  underCost: boolean;
};

// ---------- Defaults shared by the settings helper and the pure modules ----------

const nullTiers = (): Record<TierKey, number | null> => ({ small: null, medium: null, large: null, xl: null });

/** Mirrors the `canvass_settings.price_tiers` column default: only leaf cleanup is priced ($30 / $40 / $50, XL on site). */
export const DEFAULT_PRICE_TIERS: TierTable = {
  leaf_cleanup: { small: 30, medium: 40, large: 50, xl: null },
  mow: nullTiers(),
  edge: nullTiers(),
  gutters: nullTiers(),
  snow: nullTiers(),
};

/** Mirrors the `canvass_settings.tier_minutes` column default: every value unknown. */
export const DEFAULT_TIER_MINUTES: TierTable = {
  leaf_cleanup: nullTiers(),
  mow: nullTiers(),
  edge: nullTiers(),
  gutters: nullTiers(),
  snow: nullTiers(),
};

/** Mirrors the `canvass_settings.tier_bounds` column default (turf sqft). */
export const DEFAULT_TIER_BOUNDS: TierBounds = { small_max: 4000, medium_max: 8000, large_max: 12000 };

/** Mirrors the `canvass_settings.score_weights` column default. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = { lawn: 1, customer: 1, owner: 1 };

/** Mirrors the `canvass_settings.crew_size` / `pay_rate` / `walk_doors` column defaults. */
export const DEFAULT_CREW_SIZE = 3;
export const DEFAULT_PAY_RATE = 15;
export const DEFAULT_WALK_DOORS = 25;

/** Mirrors the `canvass_settings.season_map` column default: Dec–Mar snow, Apr–Aug mowing, Sep–Nov leaf cleanup. */
export const DEFAULT_SEASON_MAP: SeasonMap = {
  "1": "snow",
  "2": "snow",
  "3": "snow",
  "4": "mow",
  "5": "mow",
  "6": "mow",
  "7": "mow",
  "8": "mow",
  "9": "leaf_cleanup",
  "10": "leaf_cleanup",
  "11": "leaf_cleanup",
  "12": "snow",
};

// ---------- Nightly summary ----------

/** `canvass_summaries.summary`: the shape `canvassSummarySchema` (lib/ai/schemas.ts) produces. */
export type CanvassSummaryContent = {
  headline: string;
  highlights: string[];
  best_streets: { street: string; why: string }[];
  worst_streets: { street: string; why: string }[];
  knocker_notes: string[];
  pitch_notes: string[];
  tomorrow: { street: string; why: string }[];
};
