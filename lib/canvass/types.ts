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
] as const;
export type ParcelFieldKey = (typeof PARCEL_FIELD_KEYS)[number];

export type ParcelFieldMapping = {
  /** The layer field name used, or null when nothing matched. */
  field: string | null;
  source: "auto" | "manual" | "missing";
  /** Every layer field that looked like a candidate (for the Settings dropdown). */
  candidates: string[];
};

/** `canvass_settings.parcel_field_map`: discovered at runtime from the layer metadata, owner-editable. */
export type ParcelFieldMap = Partial<Record<ParcelFieldKey, ParcelFieldMapping>> & {
  /** Every field the layer reports, so the owner can pick any of them. */
  layer_fields?: { name: string; type: string; alias: string }[];
  layer_name?: string;
  fetched_at?: string;
};

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

/** `canvass_settings.base_prices`: dollars per visit per service. */
export type BasePrices = Record<ServiceKey, number>;

/** `canvass_settings.season_map`: month ("1".."12") → featured service. */
export type SeasonMap = Record<string, ServiceKey>;

// ---------- GeoJSON (just enough) ----------

export type Position = [number, number]; // [lng, lat]
export type GeoPolygon = { type: "Polygon"; coordinates: Position[][] };
export type GeoMultiPolygon = { type: "MultiPolygon"; coordinates: Position[][][] };
export type ParcelGeom = GeoPolygon | GeoMultiPolygon;
export type GeoFeature<G = ParcelGeom> = { type: "Feature"; geometry: G; properties: Record<string, unknown> | null };
export type GeoFeatureCollection<G = ParcelGeom> = { type: "FeatureCollection"; features: GeoFeature<G>[] };

// ---------- Scoring ----------

export type ScoreBreakdown = {
  pAnswer: number;
  pConvert: number;
  value: number;
  neighborBoost: number;
};

export type QuoteRange = { low: number; high: number; mid: number; basis: string };
