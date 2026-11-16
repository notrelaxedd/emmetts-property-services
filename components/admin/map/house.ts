/** What the Map tab draws for one house. Plain module (no Leaflet), so server-rendered code can import it. */

export type MapHouse = {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  mowing: boolean
  snow: boolean
  /** Set when there's a job at this house on the day shown, e.g. "9:00 AM–10:30 AM · Leaf cleanup". */
  booked: string | null
  /** 1-based position in the route, or null when it isn't a stop. */
  order: number | null
}

export const HOUSE_COLORS = { mowing: "#327213", snow: "#2563eb", both: "#7c3aed", other: "#6b7280" } as const

export function houseColor(h: { mowing: boolean; snow: boolean }): string {
  return h.mowing && h.snow ? HOUSE_COLORS.both : h.mowing ? HOUSE_COLORS.mowing : h.snow ? HOUSE_COLORS.snow : HOUSE_COLORS.other
}
