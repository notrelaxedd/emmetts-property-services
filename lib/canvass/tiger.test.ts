import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TIGERWEB_SERVICE,
  _resetTigerCache,
  assignBlockGroups,
  blockGroupQueryUrl,
  fetchBlockGroupPolygons,
  findBlockGroupLayerId,
  geocodeBlockGroup,
  geocodeBlockGroups,
  geocoderCoordinatesUrl,
  resolveBlockGroups,
  type BlockGroupPolygon,
} from "./tiger";
import type { GeoPolygon } from "./types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (f: unknown) => f as typeof fetch;

/** The shape of tigerWMS_Current?f=pjson (trimmed). Layer ids are whatever the service reports: not hard-coded. */
const serviceFixture = {
  currentVersion: 11.2,
  serviceDescription: "TIGERweb Current",
  layers: [
    { id: 0, name: "Census Tracts Labels", parentLayerId: -1 },
    { id: 8, name: "Census Tracts", parentLayerId: -1 },
    { id: 9, name: "Census Block Groups Labels", parentLayerId: -1 },
    { id: 10, name: "Census Block Groups", parentLayerId: -1 },
    { id: 12, name: "Census Blocks", parentLayerId: -1 },
  ],
};

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

const GEOID_A = "390351621021";
const GEOID_B = "390351621022";

const polygonsFixture = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: square(-81.85, 41.47, 0.01), properties: { GEOID: GEOID_A, STATE: "39", COUNTY: "035", TRACT: "162102", BLKGRP: "1" } },
    { type: "Feature", geometry: square(-81.84, 41.47, 0.01), properties: { GEOID: GEOID_B, STATE: "39", COUNTY: "035", TRACT: "162102", BLKGRP: "2" } },
    { type: "Feature", geometry: null, properties: { GEOID: "390351621023" } },
    { type: "Feature", geometry: square(-81.83, 41.47, 0.01), properties: { STATE: "39", COUNTY: "035", TRACT: "162102", BLKGRP: "3" } },
  ],
};

const geocoderFixture = (geoid: string | null) => ({
  result: {
    input: { location: { x: -81.845, y: 41.475 } },
    geographies: {
      "Census Tracts": [{ GEOID: geoid?.slice(0, 11) ?? "" }],
      "Census Block Groups": geoid ? [{ GEOID: geoid, STATE: "39", COUNTY: "035", TRACT: geoid.slice(5, 11), BLKGRP: geoid.slice(11) }] : [],
    },
  },
});

describe("findBlockGroupLayerId", () => {
  beforeEach(() => _resetTigerCache());

  it("discovers the layer id from the service listing and caches it", async () => {
    const f = vi.fn(async () => json(serviceFixture));
    expect(await findBlockGroupLayerId({ fetchImpl: asFetch(f) })).toBe(10);
    expect(await findBlockGroupLayerId({ fetchImpl: asFetch(f) })).toBe(10);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`${TIGERWEB_SERVICE}?f=pjson`);
  });
  it("throws when the service has no block-group layer or returns an error body", async () => {
    const none = vi.fn(async () => json({ layers: [{ id: 1, name: "States" }] }));
    await expect(findBlockGroupLayerId({ fetchImpl: asFetch(none) })).rejects.toThrow(/no "Census Block Groups" layer/);
    const err = vi.fn(async () => json({ error: { code: 499, message: "Token Required" } }));
    await expect(findBlockGroupLayerId({ fetchImpl: asFetch(err), serviceUrl: "https://tigerweb.geo.census.gov/x/MapServer" })).rejects.toThrow(
      /tigerweb service error 499/,
    );
  });
});

describe("fetchBlockGroupPolygons", () => {
  beforeEach(() => _resetTigerCache());

  it("queries by envelope in WGS84 as GeoJSON and keeps features with a polygon and a 12-digit GEOID", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("?f=pjson") ? json(serviceFixture) : json(polygonsFixture)));
    const polys = await fetchBlockGroupPolygons([-81.85, 41.47, -81.82, 41.48], { fetchImpl: asFetch(f) });
    expect(f).toHaveBeenCalledTimes(2);
    const u = new URL((f.mock.calls[1] as unknown as [string])[0]);
    expect(u.toString()).toBe(blockGroupQueryUrl(TIGERWEB_SERVICE, 10, [-81.85, 41.47, -81.82, 41.48]));
    expect(u.pathname).toBe("/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/10/query");
    expect(u.searchParams.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(u.searchParams.get("geometry")).toBe("-81.85,41.47,-81.82,41.48");
    expect(u.searchParams.get("inSR")).toBe("4326");
    expect(u.searchParams.get("outSR")).toBe("4326");
    expect(u.searchParams.get("f")).toBe("geojson");
    expect(u.searchParams.get("outFields")).toBe("GEOID,STATE,COUNTY,TRACT,BLKGRP");
    // The null-geometry feature is dropped; the one without GEOID is rebuilt from STATE+COUNTY+TRACT+BLKGRP.
    expect(polys.map((p) => p.geoid)).toEqual([GEOID_A, GEOID_B, "390351621023"]);
  });
});

describe("assignBlockGroups", () => {
  const polygons: BlockGroupPolygon[] = [
    { geoid: GEOID_A, geom: square(-81.85, 41.47, 0.01), properties: {} },
    { geoid: GEOID_B, geom: square(-81.84, 41.47, 0.01), properties: {} },
  ];
  it("uses point-in-polygon, then the nearest centroid for points outside every polygon", () => {
    const got = assignBlockGroups(
      [
        { id: "a", lng: -81.845, lat: 41.475 },
        { id: "b", lng: -81.835, lat: 41.475 },
        { id: "outside-near-b", lng: -81.829, lat: 41.475 },
        { id: "bad", lng: Number.NaN, lat: 41.475 },
      ],
      polygons,
    );
    expect(got.get("a")).toBe(GEOID_A);
    expect(got.get("b")).toBe(GEOID_B);
    expect(got.get("outside-near-b")).toBe(GEOID_B);
    expect(got.has("bad")).toBe(false);
  });
  it("is empty when there are no polygons", () => {
    expect(assignBlockGroups([{ id: "a", lng: -81.845, lat: 41.475 }], []).size).toBe(0);
  });
});

describe("census geocoder fallback", () => {
  it("builds the coordinates URL with the Public_AR_Current benchmark and Current_Current vintage", () => {
    const u = new URL(geocoderCoordinatesUrl(-81.845, 41.475));
    expect(u.host).toBe("geocoding.geo.census.gov");
    expect(u.pathname).toBe("/geocoder/geographies/coordinates");
    expect(u.searchParams.get("x")).toBe("-81.845");
    expect(u.searchParams.get("y")).toBe("41.475");
    expect(u.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(u.searchParams.get("vintage")).toBe("Current_Current");
    expect(u.searchParams.get("format")).toBe("json");
  });
  it("reads result.geographies['Census Block Groups'][0].GEOID", async () => {
    const f = vi.fn(async () => json(geocoderFixture(GEOID_A)));
    expect(await geocodeBlockGroup(-81.845, 41.475, { fetchImpl: asFetch(f) })).toBe(GEOID_A);
    const empty = vi.fn(async () => json(geocoderFixture(null)));
    expect(await geocodeBlockGroup(-81.845, 41.475, { fetchImpl: asFetch(empty) })).toBeNull();
  });
  it("keeps at most two requests in flight and tolerates a failed point", async () => {
    let inFlight = 0;
    let peak = 0;
    const f = vi.fn(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const x = new URL(url).searchParams.get("x");
      if (x === "-81.9") return new Response("boom", { status: 500 });
      return json(geocoderFixture(x === "-81.845" ? GEOID_A : GEOID_B));
    });
    const errors: string[] = [];
    const points = [
      { id: "p1", lng: -81.845, lat: 41.475 },
      { id: "p2", lng: -81.835, lat: 41.475 },
      { id: "p3", lng: -81.9, lat: 41.475 },
      { id: "p4", lng: -81.835, lat: 41.476 },
      { id: "p5", lng: -81.845, lat: 41.476 },
    ];
    const got = await geocodeBlockGroups(points, { fetchImpl: asFetch(f), onError: (p) => errors.push(p.id) });
    expect(peak).toBe(2);
    expect(f).toHaveBeenCalledTimes(5);
    expect(errors).toEqual(["p3"]);
    expect(Array.from(got.entries())).toEqual([
      ["p1", GEOID_A],
      ["p2", GEOID_B],
      ["p4", GEOID_B],
      ["p5", GEOID_A],
    ]);
  });
});

describe("resolveBlockGroups", () => {
  beforeEach(() => _resetTigerCache());

  it("uses TIGERweb polygons first and the geocoder only for what is left", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("?f=pjson")) return json(serviceFixture);
      if (url.includes("tigerweb")) return json(polygonsFixture);
      return json(geocoderFixture(GEOID_B));
    });
    const r = await resolveBlockGroups([{ id: "a", lng: -81.845, lat: 41.475 }], [-81.85, 41.47, -81.82, 41.48], { fetchImpl: asFetch(f) });
    expect(r.assigned.get("a")).toBe(GEOID_A);
    expect(r.viaGeocoder).toBe(0);
    expect(r.polygons).toHaveLength(3);
    expect(f.mock.calls.some(([u]) => String(u).includes("geocoding.geo.census.gov"))).toBe(false);
  });

  it("falls back to the geocoder when TIGERweb returns nothing or fails", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("?f=pjson")) return json(serviceFixture);
      if (url.includes("tigerweb")) return json({ type: "FeatureCollection", features: [] });
      return json(geocoderFixture(GEOID_B));
    });
    const r = await resolveBlockGroups([{ id: "a", lng: -81.845, lat: 41.475 }], [-81.85, 41.47, -81.82, 41.48], { fetchImpl: asFetch(f) });
    expect(r.assigned.get("a")).toBe(GEOID_B);
    expect(r.viaGeocoder).toBe(1);

    _resetTigerCache();
    const errors: string[] = [];
    const down = vi.fn(async (url: string) => (url.includes("tigerweb") ? new Response("x", { status: 502 }) : json(geocoderFixture(GEOID_A))));
    const r2 = await resolveBlockGroups([{ id: "a", lng: -81.845, lat: 41.475 }], [-81.85, 41.47, -81.82, 41.48], {
      fetchImpl: asFetch(down),
      onError: (p) => errors.push(p.id),
    });
    expect(errors).toEqual(["*"]);
    expect(r2.assigned.get("a")).toBe(GEOID_A);
    expect(r2.polygons).toEqual([]);
  });
});
