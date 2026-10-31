/**
 * Test fixtures shaped like an ArcGIS MapServer layer description and a GeoJSON query page.
 *
 * The field names here are PLAUSIBLE, not real: the county host could not be reached while this was written, so
 * these fixtures only prove that the field map adapts to whatever the layer reports. The real names are discovered
 * at runtime by `fetchLayerMeta` and shown in Settings.
 */

/** Fixture A: Cuyahoga-style spellings (PARCELPIN, DEEDED_OWNER, PARCEL_ADDRESS, ...). */
export const layerMetaFixtureA = {
  currentVersion: 11.1,
  id: 1,
  name: "Combined Parcels - Non-Cleveland",
  type: "Feature Layer",
  geometryType: "esriGeometryPolygon",
  maxRecordCount: 2000,
  supportedQueryFormats: "JSON, geoJSON, PBF",
  advancedQueryCapabilities: { supportsPagination: true, supportsStatistics: true },
  extent: { spatialReference: { wkid: 102722, latestWkid: 3734 } },
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "PARCELPIN", type: "esriFieldTypeString", alias: "Parcel PIN" },
    { name: "DEEDED_OWNER", type: "esriFieldTypeString", alias: "Deeded Owner" },
    { name: "PARCEL_ADDRESS", type: "esriFieldTypeString", alias: "Parcel Address" },
    { name: "PARCEL_CITY", type: "esriFieldTypeString", alias: "Parcel City" },
    { name: "PARCEL_ZIP", type: "esriFieldTypeString", alias: "Parcel Zip" },
    { name: "MAIL_ADDR1", type: "esriFieldTypeString", alias: "Mailing Address 1" },
    { name: "MAIL_CITY", type: "esriFieldTypeString", alias: "Mailing City" },
    { name: "MAIL_ZIP", type: "esriFieldTypeString", alias: "Mailing Zip" },
    { name: "LAND_USE", type: "esriFieldTypeString", alias: "Land Use Code" },
    { name: "LAND_USE_DESC", type: "esriFieldTypeString", alias: "Land Use Description" },
    { name: "TAX_LUC", type: "esriFieldTypeString", alias: "Tax Land Use Code" },
    { name: "PARCEL_ACREAGE", type: "esriFieldTypeDouble", alias: "Parcel Acreage" },
    { name: "TOTAL_MARKET_VALUE", type: "esriFieldTypeDouble", alias: "Total Market Value" },
    { name: "LAND_MARKET_VALUE", type: "esriFieldTypeDouble", alias: "Land Market Value" },
    { name: "YEAR_BUILT", type: "esriFieldTypeSmallInteger", alias: "Year Built" },
    { name: "TOTAL_LIVING_AREA", type: "esriFieldTypeDouble", alias: "Total Living Area" },
    { name: "STORIES", type: "esriFieldTypeDouble", alias: "Stories" },
    { name: "HOMESTEAD", type: "esriFieldTypeString", alias: "Homestead Exemption" },
    { name: "SHAPE_Area", type: "esriFieldTypeDouble", alias: "SHAPE_Area" },
    { name: "SHAPE_Length", type: "esriFieldTypeDouble", alias: "SHAPE_Length" },
  ],
};

/** Fixture B: the same information under different spellings, several only recognisable by alias. */
export const layerMetaFixtureB = {
  id: 1,
  name: "Parcels",
  type: "Feature Layer",
  maxRecordCount: 1000,
  supportsPagination: true,
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "PIN", type: "esriFieldTypeString", alias: "PIN" },
    { name: "OWNER_NAME", type: "esriFieldTypeString", alias: "Owner" },
    { name: "OWNER_ZIP", type: "esriFieldTypeString", alias: "Owner Zip" },
    { name: "FULL_ADDR", type: "esriFieldTypeString", alias: "Site Address" },
    { name: "CITY", type: "esriFieldTypeString", alias: "City" },
    { name: "ZIPCODE", type: "esriFieldTypeString", alias: "Zip" },
    { name: "TAX_MAIL_ADDR", type: "esriFieldTypeString", alias: "Tax Mailing Address" },
    { name: "PROP_CLASS_CD", type: "esriFieldTypeString", alias: "Property Class" },
    { name: "CALC_ACRES", type: "esriFieldTypeDouble", alias: "Calculated Acres" },
    { name: "MKT_TOTAL", type: "esriFieldTypeDouble", alias: "Market Value Total" },
    { name: "YR_BUILT", type: "esriFieldTypeInteger", alias: "Year Built" },
    { name: "TLA", type: "esriFieldTypeDouble", alias: "Total Living Area" },
    { name: "STORY_HEIGHT", type: "esriFieldTypeString", alias: "Stories" },
    { name: "BLDG_SQFT", type: "esriFieldTypeDouble", alias: "Building Footprint" },
    { name: "ROLLBACK_2_5", type: "esriFieldTypeString", alias: "2.5% Rollback" },
    { name: "Shape__Area", type: "esriFieldTypeDouble", alias: "Shape__Area" },
  ],
};

const lot = (lng: number, lat: number) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [lng, lat],
      [lng + 0.0002, lat],
      [lng + 0.0002, lat + 0.0003],
      [lng, lat + 0.0003],
      [lng, lat],
    ] as [number, number][],
  ],
});

/** One GeoJSON page with fixture-A attribute names. */
export const parcelFeaturesFixtureA = [
  {
    type: "Feature" as const,
    id: 1,
    geometry: lot(-81.8396, 41.4756),
    properties: {
      OBJECTID: 1,
      PARCELPIN: "301-12-034",
      DEEDED_OWNER: "SMITH JOHN & JANE",
      PARCEL_ADDRESS: "19000 DETROIT RD",
      PARCEL_CITY: "ROCKY RIVER",
      PARCEL_ZIP: "44116",
      MAIL_ADDR1: "19000 DETROIT RD",
      MAIL_CITY: "ROCKY RIVER",
      MAIL_ZIP: "44116",
      LAND_USE: "510",
      LAND_USE_DESC: "SINGLE FAMILY DWELLING",
      TAX_LUC: "510",
      PARCEL_ACREAGE: 0.19,
      TOTAL_MARKET_VALUE: 285400,
      LAND_MARKET_VALUE: 61200,
      YEAR_BUILT: 1956,
      TOTAL_LIVING_AREA: 1624,
      STORIES: 1.5,
      HOMESTEAD: "N",
      SHAPE_Area: 8276.4,
      SHAPE_Length: 380.1,
    },
  },
  {
    type: "Feature" as const,
    id: 2,
    geometry: lot(-81.8392, 41.4756),
    properties: {
      OBJECTID: 2,
      PARCELPIN: "301-12-035",
      DEEDED_OWNER: "LAKEWOOD RENTAL HOLDINGS LLC",
      PARCEL_ADDRESS: "19010 DETROIT RD",
      PARCEL_CITY: "ROCKY RIVER",
      PARCEL_ZIP: "44116",
      MAIL_ADDR1: "PO BOX 771",
      MAIL_CITY: "LAKEWOOD",
      MAIL_ZIP: "44107",
      LAND_USE: "520",
      LAND_USE_DESC: "TWO FAMILY DWELLING",
      TAX_LUC: "520",
      PARCEL_ACREAGE: null,
      TOTAL_MARKET_VALUE: 198000,
      LAND_MARKET_VALUE: 50000,
      YEAR_BUILT: 0,
      TOTAL_LIVING_AREA: 2210,
      STORIES: 2,
      HOMESTEAD: "",
      SHAPE_Area: 6200.2,
      SHAPE_Length: 330,
    },
  },
  {
    type: "Feature" as const,
    id: 3,
    geometry: null,
    properties: {
      OBJECTID: 3,
      PARCELPIN: "",
      DEEDED_OWNER: "CITY OF ROCKY RIVER",
      PARCEL_ADDRESS: "",
      LAND_USE: "640",
    },
  },
];

/** One GeoJSON page with fixture-B attribute names. */
export const parcelFeaturesFixtureB = [
  {
    type: "Feature" as const,
    id: 11,
    geometry: lot(-81.84, 41.476),
    properties: {
      OBJECTID: 11,
      PIN: "30112036",
      OWNER_NAME: "DOE MARY TR",
      OWNER_ZIP: "44116",
      FULL_ADDR: "2001 WOOSTER RD UNIT 2",
      CITY: "ROCKY RIVER",
      ZIPCODE: "44116",
      TAX_MAIL_ADDR: "2001 WOOSTER RD UNIT 2 ROCKY RIVER OH 44116",
      PROP_CLASS_CD: "511",
      CALC_ACRES: "0.25",
      MKT_TOTAL: "$412,500",
      YR_BUILT: 1972,
      TLA: 2050,
      STORY_HEIGHT: "2",
      BLDG_SQFT: 1100,
      ROLLBACK_2_5: "Y",
      Shape__Area: 10890,
    },
  },
];
