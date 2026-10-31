/**
 * The single `canvass_settings` row (server-side; service-role client). JSON columns are merged over
 * their defaults so a partial blob written by an older build never breaks the planner.
 */
import { CANVASS_SETTINGS_ID } from "../db/types";
import type { CanvassSettings } from "../db/types";
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import { DEFAULT_BASE_PRICES, DEFAULT_SEASON_MAP, PARCEL_FIELD_KEYS, SERVICE_KEYS, emptyParcelFieldMap } from "./types";
import type { BasePrices, ParcelFieldMap, ParcelFieldMapPatch, ParcelFieldMapping, SeasonMap, ServiceKey } from "./types";

export { DEFAULT_BASE_PRICES, DEFAULT_SEASON_MAP };

export type CanvassSettingsPatch = Partial<
  Omit<CanvassSettings, "id" | "created_at" | "updated_at" | "base_prices" | "season_map" | "parcel_field_map">
> & {
  /** Per-service partial: `{ mow: 40 }` keeps the other prices. */
  base_prices?: Partial<BasePrices>;
  /** Per-month partial: `{ "9": "mow" }` keeps the other months. */
  season_map?: Partial<SeasonMap>;
  /** Per-key partial: an entry replaces that key's mapping; the other keys are kept. */
  parcel_field_map?: ParcelFieldMapPatch;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isService = (v: unknown): v is ServiceKey => typeof v === "string" && (SERVICE_KEYS as string[]).includes(v);

/** Merge a (possibly partial / malformed) stored base_prices blob over the defaults. Non-numbers fall back. */
export function mergeBasePrices(stored: unknown, over?: Partial<BasePrices>): BasePrices {
  const base = isObject(stored) ? stored : {};
  const patch = (over ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_BASE_PRICES };
  for (const k of SERVICE_KEYS) {
    const v = patch[k] ?? base[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
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
    base_prices: mergeBasePrices(row.base_prices),
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
  const { base_prices, season_map, parcel_field_map, ...rest } = patch;
  const update: Partial<CanvassSettings> = { ...rest };
  if (base_prices || season_map || parcel_field_map) {
    const current = await getCanvassSettings(db);
    if (base_prices) update.base_prices = mergeBasePrices(current.base_prices, base_prices);
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
