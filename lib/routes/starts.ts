/** Where a day's route can leave from (Map tab). Pure: no database. */
import type { RouteStart, RouteStartKey } from "../db/types";

export const START_SLOTS: { key: RouteStartKey; label: string }[] = [
  { key: "school", label: "School" },
  { key: "home", label: "My house" },
  { key: "emmett", label: "Emmett's house" },
];

export type StartSlot = { key: RouteStartKey; label: string; address: string | null; lat: number | null; lng: number | null };

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The three slots in display order, filled from whatever is stored (missing / malformed entries come back empty). */
export function startSlots(stored: unknown): StartSlot[] {
  const list = Array.isArray(stored) ? (stored as Partial<RouteStart>[]) : [];
  return START_SLOTS.map(({ key, label }) => {
    const hit = list.find((s) => s && typeof s === "object" && s.key === key);
    const lat = finite(hit?.lat);
    const lng = finite(hit?.lng);
    const address = typeof hit?.address === "string" && hit.address.trim() ? hit.address.trim() : null;
    return { key, label, address, lat: lat !== null && lng !== null ? lat : null, lng: lat !== null && lng !== null ? lng : null };
  });
}

/** The stored array with one slot replaced. */
export function withStart(stored: unknown, next: RouteStart): RouteStart[] {
  const kept = startSlots(stored)
    .filter((s) => s.key !== next.key && s.address !== null && s.lat !== null && s.lng !== null)
    .map((s) => ({ key: s.key, address: s.address as string, lat: s.lat as number, lng: s.lng as number }));
  return [...kept, next];
}
