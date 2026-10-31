/**
 * Pull county parcels for a drawn area into `parcels`, assign Census block groups and make sure every block group
 * has ACS stats + a prior window. Server-side (service-role `Db`); every outbound call goes through `fetchImpl` so
 * tests run on fixtures. Hosts: gis.cuyahogacounty.gov, tigerweb.geo.census.gov, geocoding.geo.census.gov,
 * api.census.gov only.
 *
 * Upsert rule (`mergeParcelRow`): the county refreshes its own columns + `raw` + `fetched_at`; everything the crew,
 * the homeowner or the owner wrote (`callback_window`, `home_pattern`, `do_not_knock` + reason, `turf_sqft_traced`,
 * `turf_geom`, `customer_id`, `block_group_geoid`) is kept on conflict.
 */
import type { BlockGroup, CanvassSettings, Parcel } from "../db/types";
import { check } from "../ops/types";
import type { Db } from "../ops/types";
import { acsStatsOf, fetchAllBlockGroupTables, parseAcs } from "./census";
import type { BlockGroupStats } from "./census";
import {
  buildFieldMap,
  fetchLayerMeta,
  isResidential,
  manualOverrides,
  missingFieldKeys,
  normalizeAddress,
  parcelFromFeature,
  parcelLayerUrl,
  queryParcels,
} from "./county";
import type { LayerMeta, ParcelInput } from "./county";
import { bboxOf } from "./geometry";
import type { Bbox } from "./geometry";
import { estimateTurf } from "./quote";
import { fillMissingCityZip } from "./reverse";
import { getCanvassSettings, updateCanvassSettings } from "./settings";
import { resolveBlockGroups } from "./tiger";
import type { BlockGroupPolygon } from "./tiger";
import { PARCEL_FIELD_KEYS } from "./types";
import type { GeoPolygon, ParcelFieldKey, ParcelFieldMap } from "./types";
import { acsPrior, emptyPrior } from "./windows";

const CHUNK = 100;
/** Layer metadata is re-read from the county at most once a day per process. */
export const LAYER_META_TTL_MS = 24 * 60 * 60 * 1000;
/** Customers scanned when linking pulled parcels to existing customers. */
const CUSTOMER_LIMIT = 5000;

export type PullOpts = { fetchImpl?: typeof fetch; log?: (msg: string) => void; now?: () => Date };

export type PullResult = {
  pulled: number;
  residential: number;
  inserted: number;
  updated: number;
  blockGroupsAssigned: number;
  acsFetched: number;
  /** Parcels whose blank city or ZIP was filled from TIGERweb places / ZCTAs. */
  cityZipFilled: number;
  warnings: string[];
  fieldMap: ParcelFieldMap;
  missing: ParcelFieldKey[];
};

// ---------- Layer metadata cache ----------

let layerMetaCache: { layerUrl: string; meta: LayerMeta; at: number } | null = null;

/** Test hook. */
export function _resetLayerMetaCache() {
  layerMetaCache = null;
}

/** `fetchLayerMeta`, cached for 24 h per layer URL in this process. */
export async function cachedLayerMeta(opts: { fetchImpl?: typeof fetch; now?: () => Date; force?: boolean } = {}): Promise<LayerMeta> {
  const layerUrl = parcelLayerUrl();
  const nowMs = (opts.now ?? (() => new Date()))().getTime();
  if (!opts.force && layerMetaCache && layerMetaCache.layerUrl === layerUrl && nowMs - layerMetaCache.at < LAYER_META_TTL_MS) {
    return layerMetaCache.meta;
  }
  const meta = await fetchLayerMeta({ fetchImpl: opts.fetchImpl, layerUrl });
  layerMetaCache = { layerUrl, meta, at: nowMs };
  return meta;
}

// ---------- Field map persistence ----------

/** What matters for "did the map change": each key's field + source, and whether the layer fields are stored. */
export function fieldMapSignature(map: Partial<ParcelFieldMap> | null | undefined): string {
  if (!map) return "";
  const keys = PARCEL_FIELD_KEYS.map((k) => `${k}=${map[k]?.field ?? ""}:${map[k]?.source ?? "missing"}`);
  return `${keys.join("|")}|fields=${map.layer_fields?.length ?? 0}|layer=${map.layer_name ?? ""}`;
}

/** Rebuild the field map from the layer, keeping the owner's manual picks, and store it when it changed. */
async function resolveFieldMap(db: Db, settings: CanvassSettings, meta: LayerMeta, now: Date): Promise<ParcelFieldMap> {
  const fieldMap = buildFieldMap(meta.fields, manualOverrides(settings.parcel_field_map), { layerName: meta.name, fetchedAt: now.toISOString() });
  if (fieldMapSignature(fieldMap) !== fieldMapSignature(settings.parcel_field_map)) {
    await updateCanvassSettings(db, { parcel_field_map: fieldMap });
  }
  return fieldMap;
}

// ---------- Rows ----------

/** The county-owned columns of a `parcels` row (what a re-pull may overwrite). */
export type CountyColumns = Pick<
  Parcel,
  | "parcel_id"
  | "address"
  | "street"
  | "city"
  | "state"
  | "zip"
  | "owner_display"
  | "mailing_address"
  | "land_use"
  | "lot_sqft"
  | "living_sqft"
  | "stories"
  | "footprint_sqft"
  | "year_built"
  | "market_value"
  | "owner_occupied"
  | "owner_is_entity"
  | "geom"
  | "centroid_lat"
  | "centroid_lng"
  | "turf_sqft_est"
  | "raw"
  | "fetched_at"
>;

/** The columns the app owns: never touched by a pull. */
export const APP_OWNED_COLUMNS = [
  "block_group_geoid",
  "turf_sqft_traced",
  "turf_geom",
  "callback_window",
  "home_pattern",
  "do_not_knock",
  "do_not_knock_reason",
  "customer_id",
] as const satisfies readonly (keyof Parcel)[];

/** A fetched feature → the county columns, with the turf estimate from the current settings. */
export function countyColumns(input: ParcelInput, settings: Pick<CanvassSettings, "hardscape_pct">, fetchedAt: Date): CountyColumns {
  return {
    parcel_id: input.parcel_id,
    address: input.address,
    street: input.street,
    city: input.city,
    state: input.state,
    zip: input.zip,
    owner_display: input.owner_display,
    mailing_address: input.mailing_address,
    land_use: input.land_use,
    lot_sqft: input.lot_sqft,
    living_sqft: input.living_sqft,
    stories: input.stories,
    footprint_sqft: input.footprint_sqft,
    year_built: input.year_built,
    market_value: input.market_value,
    owner_occupied: input.owner_occupied,
    owner_is_entity: input.owner_is_entity,
    geom: input.geom,
    centroid_lat: input.centroid_lat,
    centroid_lng: input.centroid_lng,
    turf_sqft_est: estimateTurf(input, settings.hardscape_pct),
    raw: input.raw,
    fetched_at: fetchedAt.toISOString(),
  };
}

/**
 * The update payload for an existing row: the incoming county columns only. App-owned columns are absent from the
 * payload, so `{ ...existing, ...mergeParcelRow(existing, incoming) }` keeps the crew's / homeowner's data. A county
 * value that came back empty does not wipe a value we already had (e.g. a feature without geometry keeps its polygon).
 */
export function mergeParcelRow(existing: Parcel, incoming: CountyColumns): Partial<Parcel> {
  const out: Partial<Parcel> = {};
  for (const key of Object.keys(incoming) as (keyof CountyColumns)[]) {
    if ((APP_OWNED_COLUMNS as readonly string[]).includes(key)) continue;
    const value = incoming[key];
    const keepExisting =
      (value === null || value === "" || (key === "raw" && Object.keys(value as object).length === 0)) &&
      existing[key] !== null &&
      existing[key] !== undefined &&
      existing[key] !== "";
    // owner_is_entity is derived from the owner: when the owner came back empty keep the old flag too.
    if (key === "owner_is_entity" && incoming.owner_display === null && existing.owner_display) continue;
    (out as Record<string, unknown>)[key] = keepExisting ? existing[key] : value;
  }
  return out;
}

const dedupeByParcelId = (inputs: ParcelInput[]): ParcelInput[] => {
  const byId = new Map<string, ParcelInput>();
  for (const p of inputs) byId.set(p.parcel_id, p);
  return Array.from(byId.values());
};

async function inChunks<T>(ids: readonly string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await fetchChunk(unique.slice(i, i + CHUNK))));
  return out;
}

type TouchedRow = Pick<Parcel, "id" | "parcel_id" | "address" | "city" | "zip" | "centroid_lat" | "centroid_lng" | "block_group_geoid" | "customer_id">;

// ---------- Block groups ----------

/** `block_groups` columns filled from ACS stats (null stats → null columns). */
export function blockGroupColumns(stats: BlockGroupStats | null, settings: Parameters<typeof acsPrior>[1], vintage: string, fetchedAt: Date | null) {
  const prior = stats ? acsPrior(acsStatsOf(stats), settings) : emptyPrior();
  return {
    pct_not_in_lf: stats?.pct_not_in_lf ?? null,
    pct_hh_nonworking_parent: stats?.pct_hh_nonworking_parent ?? null,
    pct_65_plus: stats?.pct_65_plus ?? null,
    median_hh_income: stats?.median_hh_income ?? null,
    depart_dist: stats?.depart_dist ?? {},
    commute_dist: stats?.commute_dist ?? {},
    prior_window: prior,
    acs_vintage: vintage,
    fetched_at: fetchedAt ? fetchedAt.toISOString() : null,
  };
}

/**
 * Make sure every GEOID has a `block_groups` row with ACS stats and a prior. Fetches the county's ACS tables once
 * (one call per table) when any GEOID lacks stats; a failed fetch still writes the rows (null stats, `fetched_at`
 * null) so the next pull retries. Returns how many block groups got stats.
 */
export async function ensureBlockGroups(
  db: Db,
  geoids: readonly string[],
  settings: CanvassSettings,
  opts: { fetchImpl?: typeof fetch; polygons?: ReadonlyMap<string, BlockGroupPolygon>; warnings?: string[]; log?: (msg: string) => void; now?: Date } = {},
): Promise<number> {
  const wanted = Array.from(new Set(geoids.filter((g) => /^\d{12}$/.test(g))));
  if (wanted.length === 0) return 0;
  const existing = await inChunks(wanted, async (chunk) => check(await db.from("block_groups").select("geoid,fetched_at,geom").in("geoid", chunk), "block groups") ?? []);
  const byGeoid = new Map(existing.map((r) => [r.geoid, r]));
  const needStats = wanted.filter((g) => !byGeoid.get(g)?.fetched_at);
  if (needStats.length === 0) return 0;

  const now = opts.now ?? new Date();
  let stats: Map<string, BlockGroupStats> | null = null;
  try {
    opts.log?.(`[canvass] fetching ACS ${settings.acs_vintage} block-group tables for ${needStats.length} block group(s)`);
    const tables = await fetchAllBlockGroupTables({ fetchImpl: opts.fetchImpl, vintage: settings.acs_vintage, key: process.env.CENSUS_API_KEY ?? null });
    stats = parseAcs(tables);
  } catch (e) {
    opts.warnings?.push(`ACS fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  let filled = 0;
  for (const geoid of needStats) {
    const s = stats?.get(geoid) ?? null;
    if (stats && !s) opts.warnings?.push(`No ACS row for block group ${geoid}`);
    const cols = blockGroupColumns(s, settings, settings.acs_vintage, s ? now : null);
    const geom = opts.polygons?.get(geoid)?.geom ?? null;
    const row = byGeoid.get(geoid);
    if (row) {
      check(await db.from("block_groups").update({ ...cols, ...(geom && !row.geom ? { geom } : {}) }).eq("geoid", geoid), "update block group");
    } else {
      const insert: Partial<BlockGroup> = { geoid, geom, ...cols };
      check(await db.from("block_groups").insert(insert), "insert block group");
    }
    if (s) filled++;
  }
  return filled;
}

/** Recompute `prior_window` for every block group from its stored stats with the current settings. */
export async function refreshBlockGroupPriors(db: Db): Promise<{ updated: number; total: number }> {
  const settings = await getCanvassSettings(db);
  const rows = check(await db.from("block_groups").select("*").limit(5000), "block groups") ?? [];
  let updated = 0;
  for (const row of rows) {
    const prior = row.fetched_at ? acsPrior(acsStatsOf(row), settings) : emptyPrior();
    if (JSON.stringify(prior) === JSON.stringify(row.prior_window)) continue;
    check(await db.from("block_groups").update({ prior_window: prior }).eq("geoid", row.geoid), "update prior");
    updated++;
  }
  return { updated, total: rows.length };
}

// ---------- Customers ----------

/**
 * True when a customer's address, past the parcel's street line, can be this parcel's town: it names the parcel's
 * city or zip, or it names no town at all ("UNIT 2", or nothing). "LAKEWOOD OH 44107" for a Rocky River parcel is false.
 */
export function sameTown(tail: string, parcel: { city?: string | null; zip?: string | null }): boolean {
  const t = ` ${normalizeAddress(tail)} `;
  if (t.trim() === "") return true;
  const city = normalizeAddress(parcel.city);
  const zip = (parcel.zip ?? "").trim().slice(0, 5);
  if (!city && !zip) return true;
  if (city && t.includes(` ${city} `)) return true;
  if (zip && t.includes(` ${zip}`)) return true;
  // No zip and no state in the tail: nothing says it is somewhere else.
  return !/ \d{5}( |$)/.test(t) && !/ OH(IO)? /.test(t);
}

/** Link pulled parcels to existing customers by county PIN, else by normalised address (same street line, same town). Returns how many were linked. */
export async function linkCustomers(db: Db, rows: readonly TouchedRow[]): Promise<number> {
  // `== null` also catches a freshly inserted row whose default columns did not come back.
  const unlinked = rows.filter((r) => r.customer_id == null);
  if (unlinked.length === 0) return 0;
  const customers = check(await db.from("customers").select("id,address,parcel_id").limit(CUSTOMER_LIMIT), "customers") ?? [];
  if (customers.length === 0) return 0;
  const byPin = new Map<string, string>();
  const byAddress: { norm: string; id: string }[] = [];
  for (const c of customers) {
    if (c.parcel_id && !byPin.has(c.parcel_id)) byPin.set(c.parcel_id, c.id);
    const norm = normalizeAddress(c.address);
    if (norm) byAddress.push({ norm, id: c.id });
  }
  let linked = 0;
  for (const r of unlinked) {
    const addr = normalizeAddress(r.address);
    const id =
      byPin.get(r.parcel_id) ??
      (addr ? byAddress.find((c) => c.norm === addr || (c.norm.startsWith(`${addr} `) && sameTown(c.norm.slice(addr.length + 1), r)))?.id : undefined);
    if (!id) continue;
    check(await db.from("parcels").update({ customer_id: id }).eq("id", r.id), "link customer");
    linked++;
  }
  return linked;
}

// ---------- The pull ----------

/**
 * Pull every residential parcel inside the polygon: layer meta (cached) → field map (persisted when it changed) →
 * query → rows → insert / merge-update → block groups (TIGERweb, geocoder fallback) → ACS stats + priors → missing
 * city / ZIP (TIGERweb places + ZCTAs) → customer links. Throws only when nothing can be pulled (no parcel-id field, county unreachable); everything else is a warning.
 */
export async function pullParcels(db: Db, polygon: GeoPolygon, opts: PullOpts = {}): Promise<PullResult> {
  const log = opts.log ?? (() => undefined);
  const now = (opts.now ?? (() => new Date()))();
  const warnings: string[] = [];
  const settings = await getCanvassSettings(db);

  const meta = await cachedLayerMeta({ fetchImpl: opts.fetchImpl, now: opts.now });
  const fieldMap = await resolveFieldMap(db, settings, meta, now);
  const missing = missingFieldKeys(fieldMap);
  if (!fieldMap.parcel_id.field) {
    throw new Error("The county layer has no parcel id field in the field map. Open Canvass → Settings, refresh from county and pick the PIN field.");
  }
  if (missing.length > 0) warnings.push(`Field map has no match for: ${missing.join(", ")} (Settings → field map).`);
  log(`[canvass] pulling parcels from ${meta.layerUrl} (${meta.fields.length} fields)`);

  const features = await queryParcels({
    polygon,
    fetchImpl: opts.fetchImpl,
    layerUrl: meta.layerUrl,
    maxRecordCount: meta.maxRecordCount,
    onPage: (p) => log(`[canvass] page ${p.page}: ${p.received} features (${p.total} so far)`),
  });
  const inputs = dedupeByParcelId(features.map((f) => parcelFromFeature(f, fieldMap)).filter((p): p is ParcelInput => p !== null));
  const pulled = inputs.length;
  if (features.length > pulled) warnings.push(`${features.length - pulled} feature(s) had no parcel id and were skipped.`);

  const residentialInputs = fieldMap.land_use.field
    ? inputs.filter((p) => isResidential(p.land_use, settings.residential_land_use_prefixes))
    : inputs;
  if (!fieldMap.land_use.field) warnings.push("No land-use field mapped: every parcel was kept (no residential filter).");
  const residential = residentialInputs.length;

  // Existing rows by county PIN → merge-update; the rest → insert.
  const existing = await inChunks(
    residentialInputs.map((p) => p.parcel_id),
    async (chunk) => check(await db.from("parcels").select("*").in("parcel_id", chunk), "existing parcels") ?? [],
  );
  const existingByPin = new Map(existing.map((r) => [r.parcel_id, r]));
  const touched: TouchedRow[] = [];
  const toInsert: CountyColumns[] = [];
  let updated = 0;
  for (const input of residentialInputs) {
    const cols = countyColumns(input, settings, now);
    const row = existingByPin.get(input.parcel_id);
    if (row) {
      const patch = mergeParcelRow(row, cols);
      check(await db.from("parcels").update(patch).eq("id", row.id), "update parcel");
      touched.push({ ...row, ...patch, id: row.id });
      updated++;
    } else {
      toInsert.push(cols);
    }
  }
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const rows =
      check(
        await db.from("parcels").insert(chunk).select("id,parcel_id,address,city,zip,centroid_lat,centroid_lng,block_group_geoid,customer_id"),
        "insert parcels",
      ) ?? [];
    touched.push(...rows);
    inserted += rows.length;
  }
  log(`[canvass] ${pulled} pulled, ${residential} residential, ${inserted} inserted, ${updated} updated`);

  // Block groups for rows that have none yet.
  const unassigned = touched.filter((r) => !r.block_group_geoid && r.centroid_lat !== null && r.centroid_lng !== null);
  let blockGroupsAssigned = 0;
  const polygons = new Map<string, BlockGroupPolygon>();
  if (unassigned.length > 0) {
    const bbox: Bbox = bboxOf(polygon) ?? [-81.9, 41.4, -81.7, 41.6];
    const points = unassigned.map((r) => ({ id: r.id, lng: r.centroid_lng as number, lat: r.centroid_lat as number }));
    try {
      const result = await resolveBlockGroups(points, bbox, {
        fetchImpl: opts.fetchImpl,
        onError: (pt, err) => warnings.push(`Block group lookup failed for ${pt.id}: ${err instanceof Error ? err.message : String(err)}`),
      });
      for (const poly of result.polygons) polygons.set(poly.geoid, poly);
      for (const r of unassigned) {
        const geoid = result.assigned.get(r.id);
        if (!geoid) continue;
        check(await db.from("parcels").update({ block_group_geoid: geoid }).eq("id", r.id), "assign block group");
        r.block_group_geoid = geoid;
        blockGroupsAssigned++;
      }
      if (result.viaGeocoder > 0) log(`[canvass] ${result.viaGeocoder} block group(s) came from the Census geocoder fallback`);
      const stillMissing = unassigned.length - blockGroupsAssigned;
      if (stillMissing > 0) warnings.push(`${stillMissing} parcel(s) could not be assigned a block group; they use the default window until the next pull.`);
    } catch (e) {
      warnings.push(`Block group assignment failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const geoids = Array.from(new Set(touched.map((r) => r.block_group_geoid).filter((g): g is string => !!g)));
  const acsFetched = await ensureBlockGroups(db, geoids, settings, { fetchImpl: opts.fetchImpl, polygons, warnings, log, now });

  // Blank site city / zip (the county layer often has none) from where the house sits; before customer linking, which reads them.
  let cityZipFilled = 0;
  try {
    const fill = await fillMissingCityZip(
      db,
      touched.map((r) => r.id),
      { fetchImpl: opts.fetchImpl, warnings, log },
    );
    cityZipFilled = fill.filled.size;
    for (const r of touched) {
      const patch = fill.filled.get(r.id);
      if (patch?.city) r.city = patch.city;
      if (patch?.zip) r.zip = patch.zip;
    }
  } catch (e) {
    warnings.push(`City / ZIP fill failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const linked = await linkCustomers(db, touched);
    if (linked > 0) log(`[canvass] linked ${linked} parcel(s) to existing customers`);
  } catch (e) {
    warnings.push(`Customer linking failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { pulled, residential, inserted, updated, blockGroupsAssigned, acsFetched, cityZipFilled, warnings, fieldMap, missing };
}

/**
 * Read the county layer's metadata, log every field (name / type / alias) so the real names are visible in the
 * server logs, and save the auto field map (manual picks kept). Used by Settings → "Refresh from county".
 */
export async function inspectCountyLayer(db: Db, opts: PullOpts = {}): Promise<{ fieldMap: ParcelFieldMap; missing: ParcelFieldKey[]; layerName: string; fields: LayerMeta["fields"] }> {
  const settings = await getCanvassSettings(db);
  const meta = await cachedLayerMeta({ fetchImpl: opts.fetchImpl, now: opts.now, force: true });
  const log = opts.log ?? ((msg: string) => console.log(msg));
  log(`[canvass] county layer fields (${meta.layerUrl}, "${meta.name}"): ${meta.fields.map((f) => `${f.name} (${f.type}${f.alias && f.alias !== f.name ? `, "${f.alias}"` : ""})`).join("; ")}`);
  const now = (opts.now ?? (() => new Date()))();
  const fieldMap = buildFieldMap(meta.fields, manualOverrides(settings.parcel_field_map), { layerName: meta.name, fetchedAt: now.toISOString() });
  await updateCanvassSettings(db, { parcel_field_map: fieldMap });
  const missing = missingFieldKeys(fieldMap);
  log(`[canvass] field map: ${PARCEL_FIELD_KEYS.map((k) => `${k}→${fieldMap[k].field ?? "(missing)"}`).join(", ")}`);
  return { fieldMap, missing, layerName: meta.name, fields: meta.fields };
}
