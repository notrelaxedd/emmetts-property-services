/**
 * Parcel / lot-size lookup. PARCEL_SOURCE env: none (default) | cuyahoga_gis | regrid.
 * "none" returns null, meaning the owner enters lot size by hand.
 * Plain Node: no next/* imports.
 */

export type ParcelResult = { parcel_id: string | null; lot_acres: number | null; source: string };
export type ParcelQuery = { lat: number; lng: number; address?: string };

export async function lookupParcel(q: ParcelQuery, opts: { fetchImpl?: typeof fetch } = {}): Promise<ParcelResult | null> {
  const source = process.env.PARCEL_SOURCE ?? "none";
  switch (source) {
    case "none":
      return null;
    case "cuyahoga_gis":
      return lookupCuyahogaGis(q, opts);
    case "regrid":
      return lookupRegrid(q, opts);
    default:
      throw new Error(`Unknown PARCEL_SOURCE "${source}" (expected none | cuyahoga_gis | regrid)`);
  }
}

// TODO [PARCEL DATA SOURCE — ask owner]: Cuyahoga County GIS parcels. STUB, returns null.
// Likely shape (an ArcGIS REST point-in-polygon query against the county parcels FeatureServer layer):
//   GET {PARCEL_GIS_URL}/query
//     ?f=json
//     &geometry={"x":<lng>,"y":<lat>,"spatialReference":{"wkid":4326}}
//     &geometryType=esriGeometryPoint
//     &inSR=4326
//     &spatialRel=esriSpatialRelIntersects
//     &outFields=PARCELPIN,PARCEL_ID,ACRES,DEEDED_ACRES,CALC_ACRES   (field names vary; confirm on the layer)
//     &returnGeometry=false
// Response: { features: [{ attributes: { PARCELPIN: "...", ACRES: 0.31 } }] }
// The service URL and field names are NOT known yet. Do not guess a URL; confirm with the owner/county first.
// If the layer reports square feet, divide by 43,560 for acres.
async function lookupCuyahogaGis(_q: ParcelQuery, _opts: { fetchImpl?: typeof fetch }): Promise<ParcelResult | null> {
  return null;
}

// TODO [PARCEL DATA SOURCE — ask owner]: Regrid (paid API). STUB, returns null.
// Likely shape: GET https://app.regrid.com/api/v2/parcels/point?lat=<lat>&lon=<lng>&token=<REGRID_API_TOKEN>
// Response: { parcels: { features: [{ properties: { fields: { parcelnumb, ll_gisacre } } }] } }
// Needs a paid token and owner sign-off before use.
async function lookupRegrid(_q: ParcelQuery, _opts: { fetchImpl?: typeof fetch }): Promise<ParcelResult | null> {
  return null;
}
