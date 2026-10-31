/**
 * Server-side loaders for the Canvass tab (service-role `Db`). Every query is bounded: `.in()` filters go in chunks
 * of 100 ids (PostgREST URLs stay short), lists carry a limit, and only the needed columns are selected. The pure
 * assembly (window, quote, score) lives in lib/canvass/assemble.ts. No `server-only` import so the loaders can run
 * against the in-memory fake db in tests; they are only ever called from server code.
 */
import type { CanvassPlan, CanvassSettings, HangerCode, Parcel, Pitch } from "../db/types";
import { check } from "../ops/types";
import type { Db } from "../ops/types";
import { assembleParcelViews, learnedWindowsFor } from "./assemble";
import type { BlockGroupRef, CustomerRef, KnockRef, ScoreSlot } from "./assemble";
import { isResidential } from "./county";
import { distanceMeters } from "./geometry";
import { hangerConversions } from "./hangers";
import type { HangerEventRow } from "./hangers";
import { zonedToUtc } from "../scheduler/time";
import { currentSeasonFocus } from "./season";
import type { SeasonFocus } from "./season";
import { houseNumber } from "./score";
import { getCanvassSettings } from "./settings";
import { knockStats } from "./stats";
import { mostCommonGeoid } from "./streets";
import { buildWalk } from "./walk";
import type { WalkParcel } from "./walk";
import type { Position } from "./types";
import type {
  CanvassStatsResult,
  KnockView,
  ParcelDetailResult,
  ParcelView,
  ParcelViewsResult,
  PlanStopView,
  StreetRow,
  SummaryView,
  TodayPlanResult,
  WalkResultView,
} from "./views";

/** Ids per `.in()` filter. */
const CHUNK = 100;
/** Parcels loaded for the map / table when no ids are given. */
export const DEFAULT_PARCEL_LIMIT = 2000;
/** Most recent knocks the conversion model is fitted on. */
const MODEL_KNOCK_LIMIT = 5000;
/** Customers considered for the neighbor boost / customer flag. */
const CUSTOMER_LIMIT = 5000;

const BLOCK_GROUP_COLS = "geoid,prior_window,median_hh_income,pct_not_in_lf,pct_hh_nonworking_parent,commute_dist,depart_dist";
const KNOCK_COLS = "id,parcel_id,knocked_at,outcome,knocker_id,pitch_id";
const CUSTOMER_COLS = "id,address,lat,lng,parcel_id";

async function inChunks<T>(ids: readonly string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await fetchChunk(unique.slice(i, i + CHUNK))));
  return out;
}

const uniqueStrings = (values: readonly (string | null | undefined)[]): string[] =>
  Array.from(new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0)));

// ---------- Shared context ----------

type Context = {
  settings: CanvassSettings;
  season: SeasonFocus;
  blockGroups: Map<string, BlockGroupRef>;
  knocks: KnockRef[];
  knockerNames: Map<string, string>;
  customers: CustomerRef[];
};

async function loadBlockGroups(db: Db, geoids: readonly string[]): Promise<Map<string, BlockGroupRef>> {
  const rows = await inChunks(geoids, async (chunk) =>
    check(await db.from("block_groups").select(BLOCK_GROUP_COLS).in("geoid", chunk), "canvass block groups") ?? [],
  );
  return new Map(rows.map((r) => [r.geoid, r]));
}

async function loadKnocksFor(db: Db, parcelIds: readonly string[]): Promise<KnockRef[]> {
  return inChunks(parcelIds, async (chunk) =>
    check(await db.from("knocks").select(KNOCK_COLS).in("parcel_id", chunk).order("knocked_at", { ascending: false }), "canvass knocks") ?? [],
  );
}

async function loadKnockerNames(db: Db, knockerIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await inChunks(knockerIds, async (chunk) => check(await db.from("profiles").select("id,name").in("id", chunk), "canvass knockers") ?? []);
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadCustomers(db: Db): Promise<CustomerRef[]> {
  return check(await db.from("customers").select(CUSTOMER_COLS).limit(CUSTOMER_LIMIT), "canvass customers") ?? [];
}

/** Settings, season, block groups, knocks (for the parcels), knocker names and customers, for a parcel list. */
async function loadContext(db: Db, parcels: readonly Parcel[], settings?: CanvassSettings): Promise<Context> {
  const s = settings ?? (await getCanvassSettings(db));
  const [blockGroups, knocks, customers] = await Promise.all([
    loadBlockGroups(db, uniqueStrings(parcels.map((p) => p.block_group_geoid))),
    loadKnocksFor(
      db,
      parcels.map((p) => p.id),
    ),
    loadCustomers(db),
  ]);
  const knockerNames = await loadKnockerNames(db, uniqueStrings(knocks.map((k) => k.knocker_id)));
  return { settings: s, season: currentSeasonFocus(s.season_map), blockGroups, knocks, knockerNames, customers };
}

/**
 * The learned window layer, pooled over the whole knock log (most recent `MODEL_KNOCK_LIMIT`), joined to the parcels
 * those knocks were on (loaded in chunks when they are not among the parcels being viewed). A block group (or street)
 * pools all of its recent knocks whichever of its houses are on screen, so the detail page, the walk, the digest and
 * the list agree on the lights.
 */
async function loadLearned(db: Db, ctx: Context, viewed: readonly Parcel[]) {
  const history =
    check(await db.from("knocks").select(KNOCK_COLS).order("knocked_at", { ascending: false }).limit(MODEL_KNOCK_LIMIT), "canvass knock history") ??
    [];
  const known = new Map(viewed.map((p) => [p.id, p]));
  const missing = uniqueStrings(history.map((k) => k.parcel_id)).filter((id) => !known.has(id));
  const extra = await inChunks(missing, async (chunk) =>
    check(await db.from("parcels").select("id,street,block_group_geoid").in("id", chunk), "canvass learned parcels") ?? [],
  );
  const parcels = [...viewed, ...extra];
  // The viewed houses' older knocks join the pool too.
  const seen = new Set(history.map((k) => k.id));
  const learnedKnocks = [...history, ...ctx.knocks.filter((k) => !seen.has(k.id))];
  return learnedWindowsFor(parcels, learnedKnocks, ctx.blockGroups, ctx.settings);
}

async function viewsFor(
  db: Db,
  parcels: readonly Parcel[],
  opts: { settings?: CanvassSettings; slot?: ScoreSlot | null; now?: Date } = {},
): Promise<{ views: ParcelView[]; ctx: Context }> {
  const ctx = await loadContext(db, parcels, opts.settings);
  const learned = await loadLearned(db, ctx, parcels);
  const views = assembleParcelViews({
    parcels,
    blockGroups: ctx.blockGroups,
    knocks: ctx.knocks,
    knockerNames: ctx.knockerNames,
    customers: ctx.customers,
    settings: ctx.settings,
    season: ctx.season,
    learned,
    slot: opts.slot ?? null,
    now: opts.now,
  });
  return { views, ctx };
}

async function loadParcelRows(db: Db, opts: { ids?: string[]; limit?: number }): Promise<Parcel[]> {
  if (opts.ids) {
    const rows = await inChunks(opts.ids, async (chunk) => check(await db.from("parcels").select("*").in("id", chunk), "canvass parcels") ?? []);
    // Keep the caller's order (plans are stored as ordered id lists).
    const byId = new Map(rows.map((r) => [r.id, r]));
    return opts.ids.map((id) => byId.get(id)).filter((p): p is Parcel => !!p);
  }
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_PARCEL_LIMIT, 10_000));
  return check(await db.from("parcels").select("*").order("fetched_at", { ascending: false }).limit(limit), "canvass parcels") ?? [];
}

// ---------- Public loaders ----------

/** The instant of a local "YYYY-MM-DD" + "HH:MM" (Ohio time) as a slot, or null when either is malformed. */
export function slotAt(date: string, hhmm: string): ScoreSlot | null {
  try {
    const at = zonedToUtc(date, hhmm.slice(0, 5));
    return Number.isFinite(at.getTime()) ? { at } : null;
  } catch {
    return null;
  }
}

/**
 * Parcels (newest fetched first, default 2000, or exactly `ids`) with window, light, simple score, quotes and last
 * knock. `slot` (optional) judges the light (and so the score) at that moment instead of now.
 */
export async function loadParcelViews(
  db: Db,
  opts: { ids?: string[]; limit?: number; slot?: ScoreSlot | null; now?: Date } = {},
): Promise<ParcelViewsResult> {
  const parcels = await loadParcelRows(db, opts);
  const { views, ctx } = await viewsFor(db, parcels, { slot: opts.slot, now: opts.now });
  const customersCount = views.filter((v) => v.isCustomer).length;
  return { parcels: views, settings: ctx.settings, season: ctx.season, customersCount };
}

/** One parcel's view plus its knock history with knocker and pitch names; null when the id is unknown. */
export async function loadParcelDetail(db: Db, id: string): Promise<ParcelDetailResult | null> {
  const rows = await loadParcelRows(db, { ids: [id] });
  const parcel = rows[0];
  if (!parcel) return null;
  const { views, ctx } = await viewsFor(db, [parcel]);
  const view = views[0];
  const knockRows = check(await db.from("knocks").select("*").eq("parcel_id", id).order("knocked_at", { ascending: false }).limit(500), "parcel knocks") ?? [];
  const pitchIds = uniqueStrings(knockRows.map((k) => k.pitch_id));
  const pitches = await inChunks(pitchIds, async (chunk) => check(await db.from("pitches").select("id,name").in("id", chunk), "knock pitches") ?? []);
  const pitchNames = new Map(pitches.map((p) => [p.id, p.name]));
  const knocks: KnockView[] = knockRows.map((k) => ({
    ...k,
    knocker_name: ctx.knockerNames.get(k.knocker_id) ?? "Crew",
    pitch_name: k.pitch_id ? (pitchNames.get(k.pitch_id) ?? null) : null,
    address: parcel.address,
  }));
  return { parcel: view, knocks, settings: ctx.settings, season: ctx.season };
}

/** Degrees of latitude / longitude that cover `meters` at this latitude (a slightly generous box). */
export function bboxAround(lat: number, lng: number, meters: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** Parcels within `radiusMeters` of a point (bounding box on the centroid columns), nearest first. */
async function parcelsWithin(db: Db, lat: number, lng: number, radiusMeters: number, rowLimit: number): Promise<{ p: Parcel; meters: number }[]> {
  const box = bboxAround(lat, lng, radiusMeters);
  const rows =
    check(
      await db
        .from("parcels")
        .select("*")
        .gte("centroid_lat", box.minLat)
        .lte("centroid_lat", box.maxLat)
        .gte("centroid_lng", box.minLng)
        .lte("centroid_lng", box.maxLng)
        .limit(rowLimit),
      "nearby parcels",
    ) ?? [];
  const here: Position = [lng, lat];
  return rows
    .map((p) => ({ p, meters: p.centroid_lat !== null && p.centroid_lng !== null ? distanceMeters(here, [p.centroid_lng, p.centroid_lat]) : Infinity }))
    .filter((x) => x.meters <= radiusMeters)
    .sort((a, b) => a.meters - b.meters);
}

/** Houses considered around the walk's start (a bounding box this size holds well over a thousand lots). */
const WALK_PARCEL_LIMIT = 2000;

/**
 * Walk Mode: the next `walk_doors` good doors within `radiusMeters` (default 800 m) of a point, in walking order.
 * Eligible = not do-not-knock, not knocked within `recency_days`, residential land use, light green or yellow at
 * `now`; ranked by simple-score points. Crew-safe: stops carry no score, profit or labor cost.
 */
export async function loadWalk(
  db: Db,
  opts: { lat: number; lng: number; radiusMeters?: number; now?: Date },
): Promise<WalkResultView> {
  const { lat, lng } = opts;
  const now = opts.now ?? new Date();
  const settings = await getCanvassSettings(db);
  const season = currentSeasonFocus(settings.season_map, now);
  const pitchRows = check(
    await db.from("pitches").select("id,name,script").eq("active", true).order("sort_order", { ascending: true }).order("name"),
    "walk pitches",
  );
  const pitches = (pitchRows ?? []) as WalkResultView["pitches"];
  const empty: WalkResultView = {
    stops: [],
    totalMeters: 0,
    counts: { candidates: 0, dnk: 0, recent: 0, notResidential: 0, badLight: 0, noLocation: 0, taken: 0 },
    season: { service: season.service, label: season.label, pitch: season.pitch },
    pitches,
  };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return empty;

  const near = await parcelsWithin(db, lat, lng, opts.radiusMeters ?? 800, WALK_PARCEL_LIMIT);
  if (near.length === 0) return empty;
  const { views } = await viewsFor(
    db,
    near.map((x) => x.p),
    { settings, now },
  );
  const byId = new Map(views.map((v) => [v.id, v]));
  const candidates: (WalkParcel & { view: ParcelView })[] = views.map((v) => ({
    id: v.id,
    centroid: v.centroid_lat !== null && v.centroid_lng !== null ? [v.centroid_lng, v.centroid_lat] : null,
    light: v.knock.light,
    points: v.simple.points,
    lastKnockAt: v.lastKnock?.knocked_at ?? null,
    do_not_knock: v.do_not_knock,
    isResidential: isResidential(v.land_use, settings.residential_land_use_prefixes),
    street: v.street,
    houseNumber: houseNumber(v.address),
    view: v,
  }));
  const walk = buildWalk({ parcels: candidates, start: { lat, lng }, n: settings.walk_doors, recencyDays: settings.recency_days, now });
  return {
    stops: walk.stops.flatMap((stop) => {
      const v = byId.get(stop.id);
      if (!v) return [];
      return [
        {
          id: v.id,
          order: stop.order,
          fullAddress: v.fullAddress,
          ownerFirstName: v.ownerFirstName,
          lat: stop.lat,
          lng: stop.lng,
          pitch: season.pitch,
          quoteLabel: v.quote.label,
          light: v.knock.light,
          callback_window: v.callback_window,
          walkMeters: stop.walkMeters,
        },
      ];
    }),
    totalMeters: walk.totalMeters,
    counts: walk.counts,
    season: { service: season.service, label: season.label, pitch: season.pitch },
    pitches,
  };
}

/** The most recent nightly summary, or null before the first run. */
export async function loadLatestSummary(db: Db): Promise<SummaryView | null> {
  const rows = check(await db.from("canvass_summaries").select("for_date,summary,created_at").order("for_date", { ascending: false }).limit(1), "canvass summary") ?? [];
  const row = rows[0];
  return row ? { for_date: row.for_date, summary: row.summary, created_at: row.created_at } : null;
}

/** Knocker + pitch stats, hanger conversions by street, the pitches and a few totals. */
export async function loadCanvassStats(db: Db): Promise<CanvassStatsResult> {
  const [knocks, pitches, codes, events, parcels] = await Promise.all([
    db.from("knocks").select("knocker_id,pitch_id,outcome").limit(20_000),
    db.from("pitches").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true }),
    db.from("hanger_codes").select("code,street"),
    db.from("hanger_events").select("code,event,visitor").limit(50_000),
    db.from("parcels").select("id,do_not_knock,customer_id").limit(20_000),
  ]);
  const knockRows = check(knocks, "stats knocks") ?? [];
  const pitchRows: Pitch[] = check(pitches, "stats pitches") ?? [];
  const codeRows = check(codes, "stats hanger codes") ?? [];
  const eventRows: HangerEventRow[] = check(events, "stats hanger events") ?? [];
  const parcelRows = check(parcels, "stats parcels") ?? [];
  const knockerNames = await loadKnockerNames(db, uniqueStrings(knockRows.map((k) => k.knocker_id)));
  const stats = knockStats(knockRows, { knockers: knockerNames, pitches: new Map(pitchRows.map((p) => [p.id, p.name])) });
  return {
    byKnocker: stats.byKnocker,
    byPitch: stats.byPitch,
    hangers: hangerConversions(codeRows, eventRows),
    pitches: pitchRows,
    totals: {
      knocks: knockRows.length,
      parcels: parcelRows.length,
      doNotKnock: parcelRows.filter((p) => p.do_not_knock).length,
      customers: parcelRows.filter((p) => p.customer_id !== null).length,
    },
  };
}

/** Pick the code shown for a street: the active one, else the newest. */
export function pickStreetCode(codes: readonly HangerCode[]): HangerCode | null {
  const sorted = codes.slice().sort((a, b) => Number(b.active) - Number(a.active) || b.created_at.localeCompare(a.created_at));
  return sorted[0] ?? null;
}

/** Distinct streets from the pulled parcels with their parcel count, most common block group and hanger code. */
export async function loadStreets(db: Db): Promise<StreetRow[]> {
  const [parcels, codes] = await Promise.all([
    db.from("parcels").select("street,block_group_geoid").limit(20_000),
    db.from("hanger_codes").select("*").order("created_at", { ascending: false }),
  ]);
  const parcelRows = check(parcels, "streets parcels") ?? [];
  const codeRows: HangerCode[] = check(codes, "streets codes") ?? [];
  const byStreet = new Map<string, { parcels: number; rows: { block_group_geoid: string | null }[] }>();
  for (const p of parcelRows) {
    const street = p.street.trim().toUpperCase();
    if (!street) continue;
    const acc = byStreet.get(street) ?? { parcels: 0, rows: [] };
    acc.parcels++;
    acc.rows.push({ block_group_geoid: p.block_group_geoid });
    byStreet.set(street, acc);
  }
  const codesByStreet = new Map<string, HangerCode[]>();
  for (const c of codeRows) {
    const key = c.street.trim().toUpperCase();
    const list = codesByStreet.get(key) ?? [];
    list.push(c);
    codesByStreet.set(key, list);
  }
  const out: StreetRow[] = [];
  byStreet.forEach((acc, street) => {
    out.push({ street, parcels: acc.parcels, block_group_geoid: mostCommonGeoid(acc.rows), code: pickStreetCode(codesByStreet.get(street) ?? []) });
  });
  return out.sort((a, b) => a.street.localeCompare(b.street));
}

/** Plan stops from parcel views in the stored order, with walking metres between consecutive centroids. */
export function stopsFromViews(views: readonly ParcelView[], start: Position | null = null): PlanStopView[] {
  let here: Position | null = start;
  return views.map((v, i) => {
    const point: Position | null = v.centroid_lat !== null && v.centroid_lng !== null ? [v.centroid_lng, v.centroid_lat] : null;
    const walkMeters = here && point ? Math.round(distanceMeters(here, point)) : 0;
    if (point) here = point;
    return {
      id: v.id,
      order: i + 1,
      address: v.address,
      fullAddress: v.fullAddress,
      owner_display: v.owner_display,
      street: v.street,
      centroid_lat: v.centroid_lat,
      centroid_lng: v.centroid_lng,
      window: v.window,
      knock: v.knock,
      plain: v.plain,
      quote: v.quote,
      score: v.simple.points,
      walkMeters,
    };
  });
}

/**
 * Plan stops for crew surfaces: the owner-only numbers (score points, labor cost, profit, under-cost flag) blanked.
 * Crew only ever sees the price label.
 */
export function crewSafeStops(stops: readonly PlanStopView[]): PlanStopView[] {
  return stops.map((s) => ({ ...s, score: 0, quote: { ...s.quote, laborCost: null, profit: null, underCost: false } }));
}

/** The newest saved plan for a date ("YYYY-MM-DD") with its stops in walking order; null when none was saved. */
export async function loadTodayPlan(db: Db, date: string): Promise<TodayPlanResult | null> {
  const rows = check(await db.from("canvass_plans").select("*").eq("for_date", date).order("created_at", { ascending: false }).limit(1), "canvass plan") ?? [];
  const plan: CanvassPlan | undefined = rows[0];
  if (!plan) return null;
  if (plan.parcel_ids.length === 0) return { plan, stops: [] };
  const slot = slotAt(plan.for_date, plan.slot_start);
  const { parcels } = await loadParcelViews(db, { ids: plan.parcel_ids, slot });
  // Do-not-knock is forever: a house flagged after the plan was saved drops out of the stops.
  return { plan, stops: stopsFromViews(parcels.filter((p) => !p.do_not_knock)) };
}
