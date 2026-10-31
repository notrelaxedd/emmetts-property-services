import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../ops/test-utils";
import { fillMissingCityZip } from "./reverse";
import { parcelRow } from "./rows.fixture";
import { TIGERWEB_SERVICE, _resetTigerCache } from "./tiger";
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

/** tigerWMS_Current?f=pjson (trimmed): layer ids are whatever the service says, found by name. */
const serviceFixture = {
  layers: [
    { id: 2, name: "Urban Areas" },
    { id: 20, name: "Census Designated Places" },
    { id: 24, name: "Incorporated Places" },
    { id: 31, name: "ZIP Code Tabulation Areas" },
    { id: 10, name: "Census Block Groups" },
  ],
};

// Rocky River (place) covers lng -81.85..-81.83; two ZCTAs split it at lng -81.84.
const placesFixture = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: square(-81.85, 41.46, 0.02), properties: { NAME: "Rocky River", GEOID: "3965998" } },
    { type: "Feature", geometry: square(-81.9, 41.46, 0.02), properties: { NAME: "Fairview Park", GEOID: "3926012" } },
  ],
};
const zctaFixture = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: square(-81.85, 41.46, 0.01), properties: { ZCTA5: "44116", GEOID: "44116" } },
    { type: "Feature", geometry: square(-81.84, 41.46, 0.01), properties: { ZCTA5: "44107", GEOID: "44107" } },
  ],
};

function tigerFetch(over: { places?: unknown; zcta?: unknown; service?: unknown; failPlaces?: boolean } = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url === `${TIGERWEB_SERVICE}?f=pjson`) return json(over.service ?? serviceFixture);
    if (url.startsWith(`${TIGERWEB_SERVICE}/24/query`)) return over.failPlaces ? json({}, 500) : json(over.places ?? placesFixture);
    if (url.startsWith(`${TIGERWEB_SERVICE}/31/query`)) return json(over.zcta ?? zctaFixture);
    return json({ error: { code: 404, message: `unexpected ${url}` } });
  });
  return { f: asFetch(f), calls };
}

const at = (lng: number, lat: number, over: Parameters<typeof parcelRow>[0] = {}) =>
  parcelRow({ centroid_lng: lng, centroid_lat: lat, city: null, zip: null, ...over });

describe("fillMissingCityZip", () => {
  beforeEach(() => _resetTigerCache());

  it("fills city from Incorporated Places and zip from ZCTAs by point-in-polygon", async () => {
    const west = at(-81.845, 41.465);
    const east = at(-81.835, 41.465);
    const db = fakeDb({ parcels: [west, east] });
    const { f, calls } = tigerFetch();
    const r = await fillMissingCityZip(db, [west.id, east.id], { fetchImpl: f });

    expect(r).toMatchObject({ checked: 2, cityFilled: 2, zipFilled: 2 });
    const rows = db.tables.parcels as unknown as { id: string; city: string; zip: string }[];
    expect(rows.find((p) => p.id === west.id)).toMatchObject({ city: "Rocky River", zip: "44116" });
    expect(rows.find((p) => p.id === east.id)).toMatchObject({ city: "Rocky River", zip: "44107" });
    expect(r.filled.get(west.id)).toEqual({ city: "Rocky River", zip: "44116" });

    // Layer ids come from the service listing (names), and only tigerweb is called, one envelope query per layer.
    expect(calls.filter((u) => u.includes("/query"))).toHaveLength(2);
    for (const u of calls) expect(u.startsWith("https://tigerweb.geo.census.gov/")).toBe(true);
    const placeUrl = new URL(calls.find((u) => u.includes("/24/query")) as string);
    expect(placeUrl.searchParams.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(placeUrl.searchParams.get("returnGeometry")).toBe("true");
  });

  it("only fills what is blank: a county city or zip is never replaced, and complete parcels cost no request", async () => {
    const cityOnly = at(-81.845, 41.465, { city: "ROCKY RIVER" });
    const zipOnly = at(-81.835, 41.465, { zip: "44111" });
    const done = at(-81.845, 41.466, { city: "ROCKY RIVER", zip: "44116" });
    const db = fakeDb({ parcels: [cityOnly, zipOnly, done] });
    const { f } = tigerFetch();
    const r = await fillMissingCityZip(db, [cityOnly.id, zipOnly.id, done.id], { fetchImpl: f });
    expect(r.checked).toBe(2);
    const rows = db.tables.parcels as unknown as { id: string; city: string; zip: string }[];
    expect(rows.find((p) => p.id === cityOnly.id)).toMatchObject({ city: "ROCKY RIVER", zip: "44116" });
    expect(rows.find((p) => p.id === zipOnly.id)).toMatchObject({ city: "Rocky River", zip: "44111" });
    expect(r.filled.has(done.id)).toBe(false);

    const none = tigerFetch();
    const r2 = await fillMissingCityZip(fakeDb({ parcels: [done] }), [done.id], { fetchImpl: none.f });
    expect(r2.checked).toBe(0);
    expect(none.calls).toEqual([]);
  });

  it("leaves a city blank outside every incorporated place and skips parcels without a location", async () => {
    const outside = at(-81.8, 41.5);
    const nowhere = parcelRow({ city: null, zip: null, centroid_lat: null, centroid_lng: null, geom: null });
    const db = fakeDb({ parcels: [outside, nowhere] });
    const { f } = tigerFetch();
    const r = await fillMissingCityZip(db, [outside.id, nowhere.id], { fetchImpl: f });
    expect(r.checked).toBe(1);
    expect(r.cityFilled).toBe(0);
    expect(r.zipFilled).toBe(0);
    expect((db.tables.parcels as unknown as { city: string | null }[])[0].city).toBeNull();
  });

  it("a failing layer warns and the other column still fills", async () => {
    const p = at(-81.845, 41.465);
    const db = fakeDb({ parcels: [p] });
    const warnings: string[] = [];
    const { f } = tigerFetch({ failPlaces: true });
    const r = await fillMissingCityZip(db, [p.id], { fetchImpl: f, warnings });
    expect(r).toMatchObject({ cityFilled: 0, zipFilled: 1 });
    expect(warnings.some((w) => /places/.test(w))).toBe(true);
    expect((db.tables.parcels as unknown as { zip: string }[])[0].zip).toBe("44116");
  });

  it("a service without the layer warns instead of throwing", async () => {
    const p = at(-81.845, 41.465);
    const db = fakeDb({ parcels: [p] });
    const warnings: string[] = [];
    const { f } = tigerFetch({ service: { layers: [{ id: 10, name: "Census Block Groups" }] } });
    const r = await fillMissingCityZip(db, [p.id], { fetchImpl: f, warnings });
    expect(r).toMatchObject({ checked: 1, cityFilled: 0, zipFilled: 0 });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("batches far-apart parcels into separate envelopes and ignores unknown ids", async () => {
    const near = at(-81.845, 41.465);
    const far = at(-81.3, 41.0);
    const db = fakeDb({ parcels: [near, far] });
    const { f, calls } = tigerFetch();
    const r = await fillMissingCityZip(db, [near.id, far.id, "00000000-0000-0000-0000-000000000000"], { fetchImpl: f });
    expect(r.checked).toBe(2);
    expect(calls.filter((u) => u.includes("/24/query"))).toHaveLength(2);
    expect(r.filled.has(near.id)).toBe(true);
    expect(r.filled.has(far.id)).toBe(false);
  });
});
