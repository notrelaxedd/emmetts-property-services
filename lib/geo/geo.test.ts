import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetNominatimThrottle,
  arcgisQueryUrl,
  bboxAround,
  censusUrl,
  geocode,
  haversineMiles,
  isInServiceArea,
  lookupParcel,
  nominatimUrl,
  parcelFromAttributes,
  propertyMapUrls,
} from "./index";

const ROCKY_RIVER = { lat: 41.4756, lng: -81.8396 }; // opsConfig.defaultBase
const DOWNTOWN_CLEVELAND = { lat: 41.4993, lng: -81.6944 }; // Public Square

describe("distance", () => {
  it("Rocky River to downtown Cleveland (straight line)", () => {
    const d = haversineMiles(ROCKY_RIVER, DOWNTOWN_CLEVELAND);
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(10);
  });
  it("matches a long-haul reference (NYC to LA is about 2445 mi)", () => {
    const d = haversineMiles({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
    expect(d).toBeGreaterThan(2430);
    expect(d).toBeLessThan(2460);
  });
  it("is zero for identical points and symmetric", () => {
    expect(haversineMiles(ROCKY_RIVER, ROCKY_RIVER)).toBe(0);
    expect(haversineMiles(ROCKY_RIVER, DOWNTOWN_CLEVELAND)).toBeCloseTo(haversineMiles(DOWNTOWN_CLEVELAND, ROCKY_RIVER), 9);
  });
  it("isInServiceArea honors the radius", () => {
    expect(isInServiceArea(DOWNTOWN_CLEVELAND, ROCKY_RIVER, 15)).toBe(true);
    expect(isInServiceArea(DOWNTOWN_CLEVELAND, ROCKY_RIVER, 5)).toBe(false);
  });
});

describe("geocode", () => {
  const saved = { ...process.env };
  beforeEach(() => _resetNominatimThrottle());
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null for GEOCODER=none (default) without fetching", async () => {
    delete process.env.GEOCODER;
    const f = vi.fn();
    expect(await geocode("123 Main St", { fetchImpl: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("builds the nominatim URL and sends a User-Agent", async () => {
    process.env.GEOCODER = "nominatim";
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify([{ lat: "41.4756", lon: "-81.8396", display_name: "Rocky River, Ohio" }]), { status: 200 }),
    );
    const r = await geocode("19000 Detroit Rd, Rocky River OH", { fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ lat: 41.4756, lng: -81.8396, formatted: "Rocky River, Ohio" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(nominatimUrl("19000 Detroit Rd, Rocky River OH"));
    expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?format=jsonv2&q=19000\+Detroit\+Rd/);
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/emmetts-property-services/);
  });

  it("returns null for empty nominatim results", async () => {
    process.env.GEOCODER = "nominatim";
    const f = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(await geocode("nowhere", { fetchImpl: f as unknown as typeof fetch })).toBeNull();
  });

  it("throttles nominatim to 1 request per second", async () => {
    process.env.GEOCODER = "nominatim";
    const f = vi.fn(async () => new Response("[]", { status: 200 }));
    const t0 = Date.now();
    await geocode("a", { fetchImpl: f as unknown as typeof fetch });
    await geocode("b", { fetchImpl: f as unknown as typeof fetch });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
  });

  it("google and mapbox require GEOCODER_API_KEY and parse results", async () => {
    process.env.GEOCODER = "google";
    delete process.env.GEOCODER_API_KEY;
    await expect(geocode("x")).rejects.toThrow(/GEOCODER_API_KEY/);

    process.env.GEOCODER_API_KEY = "k";
    const g = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "OK",
            results: [{ formatted_address: "1 Main St", place_id: "pid", geometry: { location: { lat: 1, lng: 2 } } }],
          }),
        ),
    );
    expect(await geocode("x", { fetchImpl: g as unknown as typeof fetch })).toEqual({
      lat: 1,
      lng: 2,
      formatted: "1 Main St",
      parcel_hint: "pid",
    });
    expect((g.mock.calls[0] as unknown as [string])[0]).toContain("maps.googleapis.com/maps/api/geocode/json");

    process.env.GEOCODER = "mapbox";
    const m = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            features: [{ geometry: { coordinates: [-81.8, 41.4] }, properties: { full_address: "2 Main St", mapbox_id: "mid" } }],
          }),
        ),
    );
    expect(await geocode("x", { fetchImpl: m as unknown as typeof fetch })).toEqual({
      lat: 41.4,
      lng: -81.8,
      formatted: "2 Main St",
      parcel_hint: "mid",
    });
    expect((m.mock.calls[0] as unknown as [string])[0]).toContain("api.mapbox.com/search/geocode/v6/forward");
  });
});

describe("census geocoder", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("builds the one-line-address URL and parses x/y as lng/lat", async () => {
    process.env.GEOCODER = "census";
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              addressMatches: [{ matchedAddress: "19000 DETROIT RD, ROCKY RIVER, OH, 44116", coordinates: { x: -81.8396, y: 41.4756 } }],
            },
          }),
        ),
    );
    const r = await geocode("19000 Detroit Rd, Rocky River, OH 44116", { fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ lat: 41.4756, lng: -81.8396, formatted: "19000 DETROIT RD, ROCKY RIVER, OH, 44116" });
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe(censusUrl("19000 Detroit Rd, Rocky River, OH 44116"));
    expect(url).toMatch(/^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?address=19000\+Detroit/);
    expect(url).toContain("benchmark=Public_AR_Current");
  });

  it("returns null when nothing matches", async () => {
    process.env.GEOCODER = "census";
    const f = vi.fn(async () => new Response(JSON.stringify({ result: { addressMatches: [] } })));
    expect(await geocode("nowhere", { fetchImpl: f as unknown as typeof fetch })).toBeNull();
  });
});

describe("lookupParcel", () => {
  const saved = { ...process.env };
  const q = { lat: 41.4756, lng: -81.8396, address: "x" };
  afterEach(() => {
    process.env = { ...saved };
  });
  const features = (...attrs: Record<string, unknown>[]) =>
    new Response(JSON.stringify({ features: attrs.map((attributes) => ({ attributes })) }));

  it("returns null for none and for the regrid stub", async () => {
    delete process.env.PARCEL_SOURCE;
    expect(await lookupParcel(q)).toBeNull();
    process.env.PARCEL_SOURCE = "regrid";
    expect(await lookupParcel(q)).toBeNull();
  });

  it("cuyahoga_gis requires PARCEL_GIS_URL", async () => {
    process.env.PARCEL_SOURCE = "cuyahoga_gis";
    delete process.env.PARCEL_GIS_URL;
    await expect(lookupParcel(q)).rejects.toThrow(/PARCEL_GIS_URL/);
  });

  it("queries the layer with the point in WGS84 and reads PIN + acres", async () => {
    process.env.PARCEL_SOURCE = "cuyahoga_gis";
    process.env.PARCEL_GIS_URL = "https://gis.example/arcgis/rest/services/Parcels/FeatureServer/0/";
    const f = vi.fn(async () => features({ PARCELPIN: "301-04-011", CALC_ACRES: 0.2154, OWNER: "x" }));
    expect(await lookupParcel(q, { fetchImpl: f as unknown as typeof fetch })).toEqual({
      parcel_id: "301-04-011",
      lot_acres: 0.215,
      source: "cuyahoga_gis",
    });
    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL((f.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin + url.pathname).toBe("https://gis.example/arcgis/rest/services/Parcels/FeatureServer/0/query");
    expect(url.searchParams.get("geometry")).toBe("-81.8396,41.4756");
    expect(url.searchParams.get("inSR")).toBe("4326");
    expect(url.searchParams.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(url.searchParams.get("returnGeometry")).toBe("false");
    expect(url.searchParams.has("distance")).toBe(false);
  });

  it("falls back to a 20 m search only when exactly one parcel is nearby", async () => {
    process.env.PARCEL_SOURCE = "cuyahoga_gis";
    process.env.PARCEL_GIS_URL = "https://gis.example/FeatureServer/0";
    const one = vi.fn().mockResolvedValueOnce(features()).mockResolvedValueOnce(features({ parcel_id: "A", acres: "0.3" }));
    expect(await lookupParcel(q, { fetchImpl: one as unknown as typeof fetch })).toMatchObject({ parcel_id: "A", lot_acres: 0.3 });
    const near = new URL((one.mock.calls[1] as unknown as [string])[0]);
    expect(near.searchParams.get("distance")).toBe("20");
    expect(near.searchParams.get("units")).toBe("esriSRUnit_Meter");

    const two = vi.fn().mockResolvedValueOnce(features()).mockResolvedValueOnce(features({ parcel_id: "A" }, { parcel_id: "B" }));
    expect(await lookupParcel(q, { fetchImpl: two as unknown as typeof fetch })).toBeNull();
  });

  it("throws on an ArcGIS error body (HTTP 200) and on HTTP errors", async () => {
    process.env.PARCEL_SOURCE = "cuyahoga_gis";
    process.env.PARCEL_GIS_URL = "https://gis.example/FeatureServer/0";
    const err = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: "Invalid query" } })));
    await expect(lookupParcel(q, { fetchImpl: err as unknown as typeof fetch })).rejects.toThrow(/400: Invalid query/);
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    await expect(lookupParcel(q, { fetchImpl: down as unknown as typeof fetch })).rejects.toThrow(/parcel GIS 502/);
  });

  it("arcgisQueryUrl trims trailing slashes", () => {
    expect(arcgisQueryUrl("https://g/x/MapServer/2//", q)).toMatch(/^https:\/\/g\/x\/MapServer\/2\/query\?/);
  });
});

describe("parcelFromAttributes", () => {
  it("reads the Cuyahoga Parcel Fabric Taxparcels fields (parcel_id, parcel_acreage)", () => {
    const attrs = { ObjectID: 7, parcel_id: "30104011", parentpin: "301-04-011", parcel_lot_size: "60X150", parcel_acreage: 0.2066, Shape__Area: 9000 };
    expect(parcelFromAttributes(attrs, {})).toEqual({ parcel_id: "30104011", lot_acres: 0.207, source: "cuyahoga_gis" });
  });
  it("auto-detects fields case-insensitively and converts square feet", () => {
    expect(parcelFromAttributes({ ParcelPin: " 301-01-001 ", Land_SqFt: 8712 }, {})).toEqual({
      parcel_id: "301-01-001",
      lot_acres: 0.2,
      source: "cuyahoga_gis",
    });
  });
  it("prefers acres over square feet and skips empty / zero values", () => {
    expect(parcelFromAttributes({ pin: "1", calc_acres: 0, acres: "", deeded_acres: 0.5, sqft: 43560 }, {}).lot_acres).toBe(0.5);
  });
  it("honors explicit field overrides", () => {
    const env = { PARCEL_GIS_ID_FIELD: "TAXNUM", PARCEL_GIS_SQFT_FIELD: "SHAPE_AREA_FT" };
    expect(parcelFromAttributes({ TAXNUM: 42, PARCELPIN: "no", ACRES: 9, SHAPE_AREA_FT: 21780 }, env)).toEqual({
      parcel_id: "42",
      lot_acres: 0.5,
      source: "cuyahoga_gis",
    });
    expect(parcelFromAttributes({ MY_AC: 0.25, ACRES: 9 }, { PARCEL_GIS_ACRES_FIELD: "my_ac" }).lot_acres).toBe(0.25);
  });
  it("returns nulls when nothing usable is present, and drops absurd sizes", () => {
    expect(parcelFromAttributes({ OWNER: "x" }, {})).toEqual({ parcel_id: null, lot_acres: null, source: "cuyahoga_gis" });
    expect(parcelFromAttributes({ acres: 5000 }, {}).lot_acres).toBeNull();
  });
});

describe("property map", () => {
  it("builds a box around the point whose Web Mercator aspect matches the image (4:3)", () => {
    const [xmin, ymin, xmax, ymax] = bboxAround(41.4756, -81.8396);
    expect((xmin + xmax) / 2).toBeCloseTo(-81.8396, 5);
    expect((ymin + ymax) / 2).toBeCloseTo(41.4756, 5);
    const aspect = ((xmax - xmin) * Math.cos((41.4756 * Math.PI) / 180)) / (ymax - ymin);
    expect(aspect).toBeCloseTo(4 / 3, 2);
  });
  it("asks both county services for the same extent, projection and size", () => {
    const u = propertyMapUrls(41.4668, -81.8538);
    const img = new URL(u.imagery);
    const par = new URL(u.parcels);
    expect(img.pathname).toMatch(/\/IMAGERY\/.+\/MapServer\/export$/);
    expect(par.pathname).toMatch(/\/Parcel_Fabric_Taxparcels\/MapServer\/export$/);
    for (const k of ["bbox", "bboxSR", "imageSR", "size", "f"]) expect(par.searchParams.get(k)).toBe(img.searchParams.get(k));
    expect(img.searchParams.get("imageSR")).toBe("3857");
    expect(par.searchParams.get("transparent")).toBe("true");
    expect(u.google).toBe("https://www.google.com/maps/search/?api=1&query=41.4668,-81.8538");
  });
});
