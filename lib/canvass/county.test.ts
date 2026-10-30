import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COUNTY_PARCELS_SERVICE,
  buildFieldMap,
  candidateFields,
  fetchLayerMeta,
  isResidential,
  mailingMatchesSite,
  manualOverrides,
  missingFieldKeys,
  normalizeAddress,
  ownerOccupiedFlag,
  parcelFromFeature,
  parcelLayerUrl,
  parcelQueryParams,
  queryParcels,
  readMapped,
  streetOf,
} from "./county";
import { layerMetaFixtureA, layerMetaFixtureB, parcelFeaturesFixtureA, parcelFeaturesFixtureB } from "./county.fixture";
import { PARCEL_FIELD_KEYS } from "./types";

const POLY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-81.841, 41.475],
      [-81.838, 41.475],
      [-81.838, 41.477],
      [-81.841, 41.477],
      [-81.841, 41.475],
    ] as [number, number][],
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (f: unknown) => f as typeof fetch;

describe("layer URL", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("defaults to the Open Data service, layer 1, and honours CANVASS_PARCEL_LAYER_URL", () => {
    delete process.env.CANVASS_PARCEL_LAYER_URL;
    expect(parcelLayerUrl()).toBe(`${COUNTY_PARCELS_SERVICE}/1`);
    expect(parcelLayerUrl({ CANVASS_PARCEL_LAYER_URL: "https://gis.cuyahogacounty.gov/server/rest/services/X/MapServer/0/" })).toBe(
      "https://gis.cuyahogacounty.gov/server/rest/services/X/MapServer/0",
    );
    expect(parcelLayerUrl({ CANVASS_PARCEL_LAYER_URL: "  " })).toBe(`${COUNTY_PARCELS_SERVICE}/1`);
  });
});

describe("fetchLayerMeta", () => {
  it("reads name, fields and paging limits from ?f=pjson", async () => {
    const f = vi.fn(async () => json(layerMetaFixtureA));
    const meta = await fetchLayerMeta({ fetchImpl: asFetch(f), layerUrl: `${COUNTY_PARCELS_SERVICE}/1` });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`${COUNTY_PARCELS_SERVICE}/1?f=pjson`);
    expect(meta.name).toBe("Combined Parcels - Non-Cleveland");
    expect(meta.maxRecordCount).toBe(2000);
    expect(meta.supportsPagination).toBe(true);
    expect(meta.fields.map((x) => x.name)).toContain("PARCELPIN");
    expect(meta.fields.find((x) => x.name === "PARCEL_ADDRESS")?.alias).toBe("Parcel Address");
  });
  it("throws on an ArcGIS error-in-200 body and on HTTP errors", async () => {
    const err = vi.fn(async () => json({ error: { code: 400, message: "Invalid layer" } }));
    await expect(fetchLayerMeta({ fetchImpl: asFetch(err), layerUrl: "https://gis.cuyahogacounty.gov/x/MapServer/9" })).rejects.toThrow(
      /county layer error 400: Invalid layer/,
    );
    const http = vi.fn(async () => new Response("Service Unavailable", { status: 503 }));
    await expect(fetchLayerMeta({ fetchImpl: asFetch(http), layerUrl: "https://gis.cuyahogacounty.gov/x/MapServer/1" })).rejects.toThrow(
      /county layer 503/,
    );
  });
});

describe("buildFieldMap", () => {
  it("resolves every key except footprint from the Cuyahoga-style fixture", () => {
    const map = buildFieldMap(layerMetaFixtureA.fields, {}, { layerName: layerMetaFixtureA.name, fetchedAt: "2026-10-30T00:00:00Z" });
    const picked = Object.fromEntries(PARCEL_FIELD_KEYS.map((k) => [k, map[k]?.field]));
    expect(picked).toEqual({
      parcel_id: "PARCELPIN",
      owner: "DEEDED_OWNER",
      site_address: "PARCEL_ADDRESS",
      site_city: "PARCEL_CITY",
      site_zip: "PARCEL_ZIP",
      mailing_address: "MAIL_ADDR1",
      land_use: "LAND_USE",
      acreage: "PARCEL_ACREAGE",
      shape_area: "SHAPE_Area",
      market_value: "TOTAL_MARKET_VALUE",
      year_built: "YEAR_BUILT",
      living_sqft: "TOTAL_LIVING_AREA",
      stories: "STORIES",
      footprint_sqft: null,
      owner_occupied: "HOMESTEAD",
      street: null, // derived from the site address when the layer has no street field
    });
    expect(map.footprint_sqft?.source).toBe("missing");
    expect(map.parcel_id?.source).toBe("auto");
    expect(missingFieldKeys(map)).toEqual(["footprint_sqft"]);
    // Every candidate is recorded (TAX_LUC is a second land-use option; LAND_USE_DESC is excluded as a description).
    expect(map.land_use?.candidates).toEqual(["LAND_USE", "TAX_LUC"]);
    expect(map.market_value?.candidates).toEqual(["TOTAL_MARKET_VALUE"]);
    expect(map.layer_fields?.length).toBe(layerMetaFixtureA.fields.length);
    expect(map.layer_name).toBe("Combined Parcels - Non-Cleveland");
    expect(map.fetched_at).toBe("2026-10-30T00:00:00Z");
  });

  it("adapts to a layer with different spellings, matching on alias when the name says nothing", () => {
    const map = buildFieldMap(layerMetaFixtureB.fields);
    const picked = Object.fromEntries(PARCEL_FIELD_KEYS.map((k) => [k, map[k]?.field]));
    expect(picked).toEqual({
      parcel_id: "PIN",
      owner: "OWNER_NAME",
      site_address: "FULL_ADDR", // alias "Site Address"
      site_city: "CITY",
      site_zip: "ZIPCODE",
      mailing_address: "TAX_MAIL_ADDR",
      land_use: "PROP_CLASS_CD", // alias "Property Class"
      acreage: "CALC_ACRES",
      shape_area: "Shape__Area",
      market_value: "MKT_TOTAL",
      year_built: "YR_BUILT",
      living_sqft: "TLA",
      stories: "STORY_HEIGHT",
      footprint_sqft: "BLDG_SQFT",
      owner_occupied: "ROLLBACK_2_5",
      street: null,
    });
    expect(missingFieldKeys(map)).toEqual([]);
    // OWNER_ZIP must not be mistaken for the site zip or the owner name.
    expect(map.site_zip?.candidates).not.toContain("OWNER_ZIP");
    expect(map.owner?.candidates).not.toContain("OWNER_ZIP");
  });

  it("prefers exact matches over contains matches, in candidate order", () => {
    const fields = [
      { name: "MAIL_ADDRESS", type: "s", alias: "Mail Address" },
      { name: "ADDRESS_FULL", type: "s", alias: "Address Full" },
      { name: "SITE_ADDRESS", type: "s", alias: "Site Address" },
    ];
    expect(candidateFields("site_address", fields)).toEqual(["SITE_ADDRESS", "ADDRESS_FULL"]);
  });

  it("keeps owner overrides as manual picks, including an explicit null", () => {
    const map = buildFieldMap(layerMetaFixtureA.fields, { land_use: "tax_luc", owner_occupied: null });
    expect(map.land_use).toEqual({ field: "TAX_LUC", source: "manual", candidates: ["LAND_USE", "TAX_LUC"] });
    expect(map.owner_occupied).toMatchObject({ field: null, source: "manual" });
    expect(manualOverrides(map)).toEqual({ land_use: "TAX_LUC", owner_occupied: null });
    expect(manualOverrides(null)).toEqual({});
  });
});

describe("queryParcels", () => {
  it("POSTs a polygon query with outSR 4326 / f=geojson and pages with resultOffset until a short page", async () => {
    const pages = [
      { type: "FeatureCollection", features: [parcelFeaturesFixtureA[0], parcelFeaturesFixtureA[1]], exceededTransferLimit: true },
      { type: "FeatureCollection", features: [parcelFeaturesFixtureA[0], parcelFeaturesFixtureA[1]], properties: { exceededTransferLimit: true } },
      { type: "FeatureCollection", features: [parcelFeaturesFixtureA[2]] },
    ];
    let call = 0;
    const f = vi.fn(async () => json(pages[call++]));
    const seen: number[] = [];
    const feats = await queryParcels({
      polygon: POLY,
      fetchImpl: asFetch(f),
      layerUrl: `${COUNTY_PARCELS_SERVICE}/1`,
      maxRecordCount: 2,
      onPage: (p) => seen.push(p.total),
    });
    expect(feats).toHaveLength(5);
    expect(seen).toEqual([2, 4, 5]);
    expect(f).toHaveBeenCalledTimes(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${COUNTY_PARCELS_SERVICE}/1/query`);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = init.body as URLSearchParams;
    expect(body.get("f")).toBe("geojson");
    expect(body.get("outSR")).toBe("4326");
    expect(body.get("inSR")).toBe("4326");
    expect(body.get("geometryType")).toBe("esriGeometryPolygon");
    expect(body.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(body.get("returnGeometry")).toBe("true");
    expect(body.get("outFields")).toBe("*");
    expect(body.get("resultOffset")).toBe("0");
    expect(body.get("resultRecordCount")).toBe("2");
    expect(JSON.parse(body.get("geometry") ?? "{}")).toEqual({ rings: POLY.coordinates, spatialReference: { wkid: 4326 } });
    const second = (f.mock.calls[1] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(second.get("resultOffset")).toBe("2");
  });

  it("stops after a full page when the server says the transfer limit was not exceeded", async () => {
    const f = vi.fn(async () => json({ type: "FeatureCollection", features: [parcelFeaturesFixtureA[0]], exceededTransferLimit: false }));
    const feats = await queryParcels({ polygon: POLY, fetchImpl: asFetch(f), layerUrl: "https://gis.cuyahogacounty.gov/x/MapServer/1", maxRecordCount: 1 });
    expect(feats).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caps the page size at 1000 and surfaces ArcGIS errors", async () => {
    const f = vi.fn(async () => json({ type: "FeatureCollection", features: [] }));
    await queryParcels({ polygon: POLY, fetchImpl: asFetch(f), layerUrl: "https://gis.cuyahogacounty.gov/x/MapServer/1", maxRecordCount: 5000 });
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).get("resultRecordCount")).toBe("1000");
    const err = vi.fn(async () => json({ error: { code: 500, message: "Unable to complete operation." } }));
    await expect(queryParcels({ polygon: POLY, fetchImpl: asFetch(err), layerUrl: "https://gis.cuyahogacounty.gov/x/MapServer/1" })).rejects.toThrow(
      /county query error 500/,
    );
  });

  it("parcelQueryParams is deterministic", () => {
    expect(parcelQueryParams(POLY, 10, 5).toString()).toBe(parcelQueryParams(POLY, 10, 5).toString());
  });
});

describe("parcelFromFeature", () => {
  const mapA = buildFieldMap(layerMetaFixtureA.fields);
  const mapB = buildFieldMap(layerMetaFixtureB.fields);

  it("maps an owner-occupied single-family parcel through fixture A", () => {
    const p = parcelFromFeature(parcelFeaturesFixtureA[0], mapA);
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      parcel_id: "301-12-034",
      address: "19000 DETROIT RD",
      street: "DETROIT RD",
      city: "ROCKY RIVER",
      zip: "44116",
      owner_display: "SMITH JOHN & JANE",
      mailing_address: "19000 DETROIT RD",
      land_use: "510",
      living_sqft: 1624,
      stories: 1.5,
      footprint_sqft: null,
      year_built: 1956,
      market_value: 285400,
      owner_is_entity: false,
    });
    expect(p!.lot_sqft).toBeCloseTo(0.19 * 43560, 1);
    // HOMESTEAD is mapped and says "N", so the field wins over the matching mailing address.
    expect(p!.owner_occupied).toBe(false);
    expect(p!.geom?.type).toBe("Polygon");
    expect(p!.centroid_lng).toBeCloseTo(-81.8395, 4);
    expect(p!.centroid_lat).toBeCloseTo(41.47575, 4);
    expect(p!.raw).toEqual(parcelFeaturesFixtureA[0].properties);
  });

  it("falls back to polygon area, mailing comparison and flags entity owners", () => {
    const p = parcelFromFeature(parcelFeaturesFixtureA[1], mapA)!;
    expect(p.owner_is_entity).toBe(true);
    // No acreage → geodesic area of the lot polygon (~6,000 sqft for the fixture lot).
    expect(p.lot_sqft).toBeGreaterThan(5500);
    expect(p.lot_sqft).toBeLessThan(6500);
    // HOMESTEAD is blank → unknown → PO box mailing address ≠ site → false.
    expect(p.owner_occupied).toBe(false);
    expect(p.year_built).toBeNull(); // 0 means "not recorded"
    expect(p.land_use).toBe("520");
  });

  it("returns null for a feature without a parcel id", () => {
    expect(parcelFromFeature(parcelFeaturesFixtureA[2], mapA)).toBeNull();
  });

  it("maps fixture B (strings with $ and commas, rollback flag, unit in the address)", () => {
    const p = parcelFromFeature(parcelFeaturesFixtureB[0], mapB)!;
    expect(p).toMatchObject({
      parcel_id: "30112036",
      address: "2001 WOOSTER RD UNIT 2",
      street: "WOOSTER RD",
      zip: "44116",
      land_use: "511",
      lot_sqft: 10890,
      market_value: 412500,
      stories: 2,
      footprint_sqft: 1100,
      living_sqft: 2050,
      owner_occupied: true,
      owner_is_entity: true, // "TR" (trustee)
    });
  });

  it("treats a null mapping as data: the key yields null", () => {
    const map = buildFieldMap(layerMetaFixtureA.fields, { owner_occupied: null, market_value: null });
    const p = parcelFromFeature(parcelFeaturesFixtureA[0], map)!;
    expect(p.market_value).toBeNull();
    // Without a homestead field the mailing address decides: it matches the site.
    expect(p.owner_occupied).toBe(true);
    expect(readMapped(parcelFeaturesFixtureA[0].properties, map, "market_value")).toBeNull();
    expect(readMapped(parcelFeaturesFixtureA[0].properties, map, "owner")).toBe("SMITH JOHN & JANE");
    expect(readMapped({ parcelpin: "x" }, map, "parcel_id")).toBe("x"); // case-insensitive attribute lookup
  });

  it("owner-occupied flag parsing", () => {
    expect(ownerOccupiedFlag("Y")).toBe(true);
    expect(ownerOccupiedFlag("no")).toBe(false);
    expect(ownerOccupiedFlag(1)).toBe(true);
    expect(ownerOccupiedFlag("0")).toBe(false);
    expect(ownerOccupiedFlag("2.5% ROLLBACK")).toBe(true);
    expect(ownerOccupiedFlag("NONE")).toBe(false);
    expect(ownerOccupiedFlag("")).toBeNull();
    expect(ownerOccupiedFlag(null)).toBeNull();
    expect(mailingMatchesSite("19000 DETROIT RD", "19000 Detroit Rd, Rocky River OH 44116")).toBe(true);
    expect(mailingMatchesSite("19000 DETROIT RD", "PO BOX 1")).toBe(false);
    expect(mailingMatchesSite("19000 DETROIT RD", null)).toBeNull();
  });
});

describe("address helpers", () => {
  it("normalizeAddress upper-cases, strips punctuation and collapses spaces", () => {
    expect(normalizeAddress("  19000 Detroit Rd.,  Apt #4 ")).toBe("19000 DETROIT RD APT 4");
    expect(normalizeAddress(null)).toBe("");
  });
  it("streetOf strips the house number, fractions, ranges and units", () => {
    expect(streetOf("19000 Detroit Rd")).toBe("DETROIT RD");
    expect(streetOf("123 1/2 Main St")).toBe("MAIN ST");
    expect(streetOf("123-125 Main St")).toBe("MAIN ST");
    expect(streetOf("123A Main St Unit 4")).toBe("MAIN ST");
    expect(streetOf("2001 Wooster Rd #2")).toBe("WOOSTER RD");
    expect(streetOf("Main St")).toBe("MAIN ST");
    expect(streetOf("")).toBe("");
  });
  it("isResidential matches land-use prefixes as strings", () => {
    const prefixes = ["510", "511", "512"];
    expect(isResidential("510", prefixes)).toBe(true);
    expect(isResidential(511, prefixes)).toBe(true);
    expect(isResidential("5100", prefixes)).toBe(true);
    expect(isResidential("520", prefixes)).toBe(false);
    expect(isResidential(null, prefixes)).toBe(false);
    expect(isResidential("510", [])).toBe(false);
  });
});
