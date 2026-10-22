/**
 * Static property map for the admin quote page: county aerial photo + county parcel outlines, both drawn by the
 * county's public ArcGIS MapServers (no key, no map library). Both images use the same extent, projection and size,
 * so the outlines line up with the photo. Plain module: no I/O.
 */

/** Cuyahoga County aerial photography (leaves-off fall flight). Newer flights appear under IMAGERY/ each year. */
export const COUNTY_IMAGERY_URL = "https://gis.cuyahogacounty.gov/server/rest/services/IMAGERY/2025_Fall_Aerial/MapServer";
/** The same tax-parcel layer the quote worker reads (PARCEL_GIS_URL), as a MapServer so it can draw outlines. */
export const COUNTY_PARCELS_URL = "https://gis.cuyahogacounty.gov/server/rest/services/CCFO/Parcel_Fabric_Taxparcels/MapServer";

export const MAP_SIZE = { width: 800, height: 600 } as const;
/** Half the map height in degrees of latitude (~60 m): a typical lot plus its neighbours. */
const HALF_HEIGHT_DEG = 0.00055;

/** WGS84 box around a point with the image's aspect ratio in Web Mercator (longitude degrees shrink with cos(lat)). */
export function bboxAround(lat: number, lng: number, size = MAP_SIZE): [number, number, number, number] {
  const halfH = HALF_HEIGHT_DEG;
  const halfW = (halfH * (size.width / size.height)) / Math.cos((lat * Math.PI) / 180);
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return [r(lng - halfW), r(lat - halfH), r(lng + halfW), r(lat + halfH)];
}

function exportUrl(service: string, lat: number, lng: number, extra: Record<string, string>): string {
  const u = new URL(`${service.replace(/\/+$/, "")}/export`);
  u.searchParams.set("bbox", bboxAround(lat, lng).join(","));
  u.searchParams.set("bboxSR", "4326");
  u.searchParams.set("imageSR", "3857");
  u.searchParams.set("size", `${MAP_SIZE.width},${MAP_SIZE.height}`);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  u.searchParams.set("f", "image");
  return u.toString();
}

export function propertyMapUrls(lat: number, lng: number) {
  return {
    imagery: exportUrl(COUNTY_IMAGERY_URL, lat, lng, { format: "jpg" }),
    parcels: exportUrl(COUNTY_PARCELS_URL, lat, lng, { format: "png32", transparent: "true", layers: "show:0" }),
    /** Opens the same spot in Google Maps (satellite) for street view and a wider look. */
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  };
}
