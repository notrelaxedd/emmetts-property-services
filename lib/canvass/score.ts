/**
 * Street and distance helpers for "is a customer nearby?": house numbers, the houses between two numbers on the
 * same side of a street, and the `NearCustomer` category the simple score reads. Pure: no next/* or db imports.
 */
import { distanceMeters } from "./geometry";
import type { NearCustomer } from "./simple-score";
import type { Position } from "./types";

// ---------- Neighbors ----------

/** A customer this close (metres, straight line) is "near". */
export const NEARBY_METERS = 150;

/** Leading house number of "1234 Elm Rd" → 1234; null when the address does not start with one. */
export function houseNumber(address: string | null | undefined): number | null {
  const m = /^\s*(\d+)/.exec(address ?? "");
  return m ? Number(m[1]) : null;
}

/** "1234 Elm Rd Apt 2" → "ELM RD APT 2": the address with the leading house number (and a unit) stripped. */
export function streetOf(address: string | null | undefined): string {
  return (address ?? "")
    .replace(/^\s*\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export type NeighborParcel = {
  address: string;
  /** Upper-cased street name without the house number (parcels.street). */
  street: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
};

export type CustomerPoint = {
  address?: string | null;
  /** Optional; derived from the address when missing. */
  street?: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * Houses between two numbers on the same side of the street (same parity). With the street's parcels
 * known it counts the real houses in between, up to the farthest known one; past that (the list is often
 * just the houses on screen) and with no list, house numbers are assumed to step by 2.
 */
export function houseDistance(a: number, b: number, parcelsOnStreet?: readonly { address: string }[]): number | null {
  if (a % 2 !== b % 2) return null; // opposite sides: the metres rule handles those
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === hi) return 0;
  if (!parcelsOnStreet || parcelsOnStreet.length === 0) return Math.ceil((hi - lo) / 2);
  const numbers = new Set<number>();
  let top = lo;
  for (const p of parcelsOnStreet) {
    const n = houseNumber(p.address);
    if (n !== null && n % 2 === lo % 2 && n > lo && n <= hi) {
      numbers.add(n);
      top = Math.max(top, n);
    }
  }
  // Known houses up to the farthest known one, then the unloaded stretch to the far house at a step of 2.
  return Math.max(1, numbers.size + Math.ceil((hi - top) / 2));
}

/**
 * How close an existing customer is, strongest first:
 *   adjacent  within `n` houses on the same street (`parcelsOnStreet`, the pulled parcels sharing the street, makes
 *             that count real houses instead of assuming numbers step by 2)
 *   near      within 150 m (so also across the street)
 *   street    somewhere on the same street
 *   none
 */
export function nearCustomerLevel(
  parcel: NeighborParcel,
  customers: readonly CustomerPoint[],
  n: number,
  parcelsOnStreet?: readonly { address: string }[],
): NearCustomer {
  const here: Position | null =
    parcel.centroid_lat !== null && parcel.centroid_lng !== null ? [parcel.centroid_lng, parcel.centroid_lat] : null;
  const myNumber = houseNumber(parcel.address);
  const myStreet = parcel.street.trim().toUpperCase() || streetOf(parcel.address);
  let best: NearCustomer = "none";
  for (const c of customers) {
    const theirStreet = c.street?.trim().toUpperCase() || streetOf(c.address);
    const sameStreet = !!myStreet && !!theirStreet && theirStreet === myStreet;
    if (sameStreet && myNumber !== null) {
      const theirNumber = houseNumber(c.address);
      if (theirNumber !== null) {
        const d = houseDistance(myNumber, theirNumber, parcelsOnStreet);
        if (d !== null && d <= n) return "adjacent";
      }
    }
    if (here && c.lat !== null && c.lng !== null && distanceMeters(here, [c.lng, c.lat]) <= NEARBY_METERS) best = "near";
    else if (sameStreet && best === "none") best = "street";
  }
  return best;
}
