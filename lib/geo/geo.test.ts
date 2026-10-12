import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetNominatimThrottle, geocode, haversineMiles, isInServiceArea, lookupParcel, nominatimUrl } from "./index";

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

describe("lookupParcel", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("returns null for none and for the TODO stubs", async () => {
    const q = { lat: 41.4756, lng: -81.8396, address: "x" };
    delete process.env.PARCEL_SOURCE;
    expect(await lookupParcel(q)).toBeNull();
    process.env.PARCEL_SOURCE = "cuyahoga_gis";
    expect(await lookupParcel(q)).toBeNull();
    process.env.PARCEL_SOURCE = "regrid";
    expect(await lookupParcel(q)).toBeNull();
  });
});
