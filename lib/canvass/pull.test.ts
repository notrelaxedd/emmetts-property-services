import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../ops/test-utils";
import { COUNTY_PARCELS_SERVICE } from "./county";
import { layerMetaFixtureA, parcelFeaturesFixtureA } from "./county.fixture";
import { GEOID_A, allGroups, dataFixtures, dataResponse } from "./census.fixture";
import type { AcsTable } from "./census";
import { _resetLayerMetaCache, blockGroupColumns, countyColumns, fieldMapSignature, inspectCountyLayer, mergeParcelRow, pullParcels, refreshBlockGroupPriors } from "./pull";
import { canvassSettingsRow, parcelRow } from "./rows.fixture";
import { _resetTigerCache, TIGERWEB_SERVICE } from "./tiger";
import type { GeoPolygon } from "./types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (f: unknown) => f as typeof fetch;

const square = (lng: number, lat: number, size: number): GeoPolygon => ({
  type: "Polygon",
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
});

/** The drawn area: covers both fixture lots at (-81.8396 / -81.8392, 41.4756). */
const AREA = square(-81.841, 41.475, 0.003);

/**
 * One fake fetch for the whole pull: county layer meta + query page, TIGERweb service listing + block-group polygons
 * (or a 503 when `tigerDown`, which sends the pull to the Census geocoder), and the six ACS tables.
 */
function pullFetch(opts: { tigerDown?: boolean; censusDown?: boolean } = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url === `${COUNTY_PARCELS_SERVICE}/1?f=pjson`) return json(layerMetaFixtureA);
    if (url === `${COUNTY_PARCELS_SERVICE}/1/query`) {
      expect(init?.method).toBe("POST");
      return json({ type: "FeatureCollection", features: parcelFeaturesFixtureA });
    }
    if (url === `${TIGERWEB_SERVICE}?f=pjson`) {
      if (opts.tigerDown) return new Response("down", { status: 503 });
      return json({ layers: [{ id: 10, name: "Census Block Groups" }] });
    }
    if (url.startsWith(`${TIGERWEB_SERVICE}/10/query`)) {
      return json({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: square(-81.85, 41.47, 0.02), properties: { GEOID: GEOID_A } }],
      });
    }
    if (url.startsWith("https://geocoding.geo.census.gov/")) {
      return json({ result: { geographies: { "Census Block Groups": [{ GEOID: GEOID_A }] } } });
    }
    if (url.startsWith("https://api.census.gov/")) {
      if (opts.censusDown) return new Response("down", { status: 503 });
      const group = /\/groups\/(B\d+)\.json$/.exec(url);
      if (group) return json(allGroups[group[1] as AcsTable]);
      const ids = (new URL(url).searchParams.get("get") ?? "").split(",").slice(1);
      return json(dataResponse(ids, dataFixtures[ids[0]?.slice(0, 6) as AcsTable]));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { f: asFetch(f), calls };
}

beforeEach(() => {
  _resetLayerMetaCache();
  _resetTigerCache();
  delete process.env.CANVASS_PARCEL_LAYER_URL;
});

describe("mergeParcelRow", () => {
  const existing = parcelRow({
    parcel_id: "PIN-1",
    callback_window: "weekdays after 5",
    home_pattern: "evenings_only",
    do_not_knock: true,
    do_not_knock_reason: "sign",
    turf_sqft_traced: 1234,
    turf_geom: { type: "FeatureCollection", features: [] },
    customer_id: "cust-1",
    block_group_geoid: "390351621021",
    market_value: 200000,
    owner_display: "OLD OWNER",
  });
  const incoming = countyColumns(
    {
      parcel_id: "PIN-1",
      address: "19000 DETROIT RD",
      street: "DETROIT RD",
      city: "ROCKY RIVER",
      zip: "44116",
      owner_display: "NEW OWNER LLC",
      mailing_address: null,
      land_use: "510",
      lot_sqft: 9000,
      living_sqft: 1500,
      stories: 2,
      footprint_sqft: null,
      year_built: 1960,
      market_value: 310000,
      owner_occupied: null,
      owner_is_entity: true,
      geom: null,
      centroid_lat: null,
      centroid_lng: null,
      raw: { PARCELPIN: "PIN-1" },
    },
    canvassSettingsRow(),
    new Date("2026-10-30T12:00:00Z"),
  );

  it("refreshes county columns and never touches the app-owned ones", () => {
    const patch = mergeParcelRow(existing, incoming);
    for (const key of ["callback_window", "home_pattern", "do_not_knock", "do_not_knock_reason", "turf_sqft_traced", "turf_geom", "customer_id", "block_group_geoid"]) {
      expect(patch).not.toHaveProperty(key);
    }
    expect(patch.market_value).toBe(310000);
    expect(patch.owner_display).toBe("NEW OWNER LLC");
    expect(patch.owner_is_entity).toBe(true);
    expect(patch.fetched_at).toBe("2026-10-30T12:00:00.000Z");
    expect(patch.turf_sqft_est).toBe(Math.round(9000 - 1500 / 2 - 9000 * 0.12));
    const merged = { ...existing, ...patch };
    expect(merged.callback_window).toBe("weekdays after 5");
    expect(merged.do_not_knock).toBe(true);
    expect(merged.turf_sqft_traced).toBe(1234);
    expect(merged.customer_id).toBe("cust-1");
  });

  it("keeps an existing value when the county came back empty for it", () => {
    const patch = mergeParcelRow(existing, incoming);
    // The feature had no geometry / mailing address: keep what we had.
    expect(patch.geom).toEqual(existing.geom);
    expect(patch.centroid_lat).toBe(existing.centroid_lat);
    expect(patch.mailing_address).toBe(existing.mailing_address);
    // An empty owner keeps the old owner and the old entity flag.
    const noOwner = mergeParcelRow(existing, { ...incoming, owner_display: null, owner_is_entity: false });
    expect(noOwner.owner_display).toBe("OLD OWNER");
    expect(noOwner).not.toHaveProperty("owner_is_entity");
  });

  it("fieldMapSignature changes when a mapping changes", () => {
    const s = canvassSettingsRow();
    const a = fieldMapSignature(s.parcel_field_map);
    const b = fieldMapSignature({ ...s.parcel_field_map, owner: { field: "DEEDED_OWNER", source: "auto", candidates: [] } });
    expect(a).not.toBe(b);
    expect(fieldMapSignature(null)).toBe("");
  });

  it("blockGroupColumns builds a prior from stats and an empty prior without them", () => {
    const s = canvassSettingsRow();
    const withStats = blockGroupColumns(
      { pct_not_in_lf: 0.5, pct_hh_nonworking_parent: 0.1, pct_65_plus: 0.2, median_hh_income: 70000, depart_dist: {}, commute_dist: {} },
      s,
      "2023",
      new Date("2026-10-30T12:00:00Z"),
    );
    expect(withStats.prior_window.daytimeFriendly).toBe(true);
    expect(withStats.fetched_at).toBe("2026-10-30T12:00:00.000Z");
    const empty = blockGroupColumns(null, s, "2023", null);
    expect(empty.prior_window.reason).toBe("No area data yet");
    expect(empty.fetched_at).toBeNull();
    expect(empty.depart_dist).toEqual({});
  });
});

describe("pullParcels (fake db + fixture fetch)", () => {
  it("inserts residential parcels, persists the field map, assigns block groups, fetches ACS and links customers", async () => {
    const db = fakeDb({
      canvass_settings: [canvassSettingsRow()],
      customers: [{ id: "cust-1", name: "Jane", address: "19000 Detroit Rd, Rocky River, OH 44116", parcel_id: null }],
    });
    const { f, calls } = pullFetch();
    const log: string[] = [];
    const r = await pullParcels(db, AREA, { fetchImpl: f, log: (m) => log.push(m), now: () => new Date("2026-10-30T12:00:00Z") });

    expect(r.pulled).toBe(2); // the third feature has no PIN
    expect(r.residential).toBe(1); // 520 (two-family) is filtered out
    expect(r.inserted).toBe(1);
    expect(r.updated).toBe(0);
    expect(r.blockGroupsAssigned).toBe(1);
    expect(r.acsFetched).toBe(1);
    expect(r.fieldMap.parcel_id.field).toBe("PARCELPIN");
    expect(r.missing).toEqual(["footprint_sqft"]);
    expect(r.warnings.some((w) => /footprint_sqft/.test(w))).toBe(true);

    const parcels = db.tables.parcels;
    expect(parcels).toHaveLength(1);
    const p = parcels[0];
    expect(p.parcel_id).toBe("301-12-034");
    expect(p.street).toBe("DETROIT RD");
    expect(p.lot_sqft).toBeCloseTo(0.19 * 43560, 0);
    expect(p.turf_sqft_est).toBe(Math.round(0.19 * 43560 - 1624 / 1.5 - 0.19 * 43560 * 0.12));
    expect(p.owner_occupied).toBe(false); // HOMESTEAD "N"
    expect(p.block_group_geoid).toBe(GEOID_A);
    expect(p.customer_id).toBe("cust-1");
    expect(p.fetched_at).toBe("2026-10-30T12:00:00.000Z");

    const bgs = db.tables.block_groups;
    expect(bgs).toHaveLength(1);
    expect(bgs[0].geoid).toBe(GEOID_A);
    expect(bgs[0].pct_not_in_lf).toBeCloseTo(420 / 900, 4);
    expect((bgs[0].prior_window as { daytimeFriendly: boolean }).daytimeFriendly).toBe(true);
    expect(bgs[0].geom).not.toBeNull();
    expect(bgs[0].fetched_at).toBe("2026-10-30T12:00:00.000Z");

    // The auto field map was stored in settings.
    const stored = db.tables.canvass_settings[0].parcel_field_map as { parcel_id: { field: string }; layer_fields: unknown[] };
    expect(stored.parcel_id.field).toBe("PARCELPIN");
    expect(stored.layer_fields.length).toBe(layerMetaFixtureA.fields.length);

    // Only allow-listed hosts were called.
    for (const url of calls) expect(url).toMatch(/^https:\/\/(gis\.cuyahogacounty\.gov|tigerweb\.geo\.census\.gov|api\.census\.gov)\//);
    expect(log.some((m) => /1 inserted/.test(m))).toBe(true);
  });

  it("a re-pull refreshes county columns, keeps the crew's data and reuses cached meta, block groups and ACS", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const { f, calls } = pullFetch();
    await pullParcels(db, AREA, { fetchImpl: f });
    const id = db.tables.parcels[0].id as string;
    // The crew and the owner wrote these in between.
    Object.assign(db.tables.parcels[0], { callback_window: "weekends", do_not_knock: true, do_not_knock_reason: "sign", turf_sqft_traced: 900, market_value: 1 });
    const before = calls.length;

    const r = await pullParcels(db, AREA, { fetchImpl: f });
    expect(r.inserted).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.blockGroupsAssigned).toBe(0);
    expect(r.acsFetched).toBe(0);
    const p = db.tables.parcels.find((x) => x.id === id)!;
    expect(p.market_value).toBe(285400); // refreshed from the county
    expect(p.callback_window).toBe("weekends");
    expect(p.do_not_knock).toBe(true);
    expect(p.do_not_knock_reason).toBe("sign");
    expect(p.turf_sqft_traced).toBe(900);
    expect(p.block_group_geoid).toBe(GEOID_A);
    // Second pull: only the parcel query (meta cached, block group known, ACS stored).
    expect(calls.slice(before)).toEqual([`${COUNTY_PARCELS_SERVICE}/1/query`]);
  });

  it("falls back to the Census geocoder when TIGERweb is down and still writes block groups when ACS fails", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const { f, calls } = pullFetch({ tigerDown: true, censusDown: true });
    const r = await pullParcels(db, AREA, { fetchImpl: f });
    expect(r.blockGroupsAssigned).toBe(1);
    expect(calls.some((u) => u.startsWith("https://geocoding.geo.census.gov/"))).toBe(true);
    expect(r.acsFetched).toBe(0);
    expect(r.warnings.some((w) => /ACS fetch failed/.test(w))).toBe(true);
    const bg = db.tables.block_groups[0];
    expect(bg.geoid).toBe(GEOID_A);
    expect(bg.fetched_at).toBeNull(); // retried on the next pull
    expect((bg.prior_window as { reason: string }).reason).toBe("No area data yet");
  });

  it("keeps the owner's manual field picks when rebuilding the map", async () => {
    const settings = canvassSettingsRow();
    settings.parcel_field_map = { ...settings.parcel_field_map, owner: { field: "LAND_USE_DESC", source: "manual", candidates: [] } };
    const db = fakeDb({ canvass_settings: [settings] });
    const { f } = pullFetch();
    const r = await pullParcels(db, AREA, { fetchImpl: f });
    expect(r.fieldMap.owner).toMatchObject({ field: "LAND_USE_DESC", source: "manual" });
    expect(db.tables.parcels[0].owner_display).toBe("SINGLE FAMILY DWELLING");
  });

  it("throws a readable error when the layer has no parcel id field", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const f = asFetch(
      vi.fn(async (url: string) => (url.endsWith("?f=pjson") ? json({ name: "Odd", fields: [{ name: "FOO", type: "x", alias: "Foo" }] }) : json({}))),
    );
    await expect(pullParcels(db, AREA, { fetchImpl: f })).rejects.toThrow(/no parcel id field/);
  });
});

describe("inspectCountyLayer / refreshBlockGroupPriors", () => {
  it("logs the layer fields and saves the auto map", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const { f } = pullFetch();
    const log: string[] = [];
    const r = await inspectCountyLayer(db, { fetchImpl: f, log: (m) => log.push(m) });
    expect(r.layerName).toBe("Combined Parcels - Non-Cleveland");
    expect(r.fieldMap.site_address.field).toBe("PARCEL_ADDRESS");
    expect(r.missing).toEqual(["footprint_sqft"]);
    expect(log[0]).toMatch(/county layer fields/);
    expect(log[0]).toContain("PARCELPIN");
    expect((db.tables.canvass_settings[0].parcel_field_map as { owner: { field: string } }).owner.field).toBe("DEEDED_OWNER");
  });

  it("recomputes priors with the current thresholds", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow({ daytime_not_in_lf_threshold: 0.9, daytime_nonworking_parent_threshold: 0.9 })] });
    const { f } = pullFetch();
    await pullParcels(db, AREA, { fetchImpl: f });
    expect((db.tables.block_groups[0].prior_window as { daytimeFriendly: boolean }).daytimeFriendly).toBe(false);
    db.tables.canvass_settings[0].daytime_not_in_lf_threshold = 0.4;
    db.tables.canvass_settings[0].daytime_nonworking_parent_threshold = 0.35;
    const r = await refreshBlockGroupPriors(db);
    expect(r).toEqual({ updated: 1, total: 1 });
    expect((db.tables.block_groups[0].prior_window as { daytimeFriendly: boolean }).daytimeFriendly).toBe(true);
    expect(await refreshBlockGroupPriors(db)).toEqual({ updated: 0, total: 1 });
  });
});
