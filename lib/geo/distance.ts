export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_MILES = 3958.7613;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInServiceArea(point: LatLng, center: LatLng, radiusMiles: number): boolean {
  return haversineMiles(point, center) <= radiusMiles;
}
