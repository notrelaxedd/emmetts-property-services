export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance between two points that may be missing coordinates; null when either is unknown. */
export function milesBetween(
  a: { lat: number | null; lng: number | null } | null | undefined,
  b: { lat: number | null; lng: number | null } | null | undefined,
): number | null {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  return haversineMiles({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
}
