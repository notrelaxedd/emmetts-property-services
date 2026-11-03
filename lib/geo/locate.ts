/** Find a customer's spot on the map for routing. Plain Node. */
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import { geocode } from "./geocode";

/** The site's geocoder, or the free Census one when none is set. Never throws. */
export async function locate(address: string): Promise<{ lat: number; lng: number } | null> {
  const env = process.env.GEOCODER;
  try {
    const hit = await geocode(address, { provider: env && env !== "none" ? env : "census" });
    return hit ? { lat: hit.lat, lng: hit.lng } : null;
  } catch {
    return null;
  }
}

/** Fill in a customer's lat/lng from their address if missing. True when they're on the map. */
export async function ensureCustomerLocation(db: Db, customerId: string): Promise<boolean> {
  const c = one(await db.from("customers").select("id,address,lat,lng").eq("id", customerId).single(), "locate(customer)");
  if (c.lat !== null && c.lng !== null) return true;
  if (!c.address) return false;
  const hit = await locate(c.address);
  if (!hit) return false;
  check(await db.from("customers").update(hit).eq("id", customerId), "locate(save)");
  return true;
}
