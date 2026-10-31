/**
 * Pure helpers for Walk Mode's crew screen: the Google Maps directions link, the progress line, the greeting and
 * price lines on the next-house card, the "Come back later" choices, and the list arithmetic for advancing and
 * re-planning. No next/* or db imports so each piece is unit-tested.
 */
import type { WalkStopView } from "./views";

/**
 * Walking directions to a house in Google Maps. Link only: it opens in a new tab and canvass code never fetches it
 * (www.google.com is in ALLOWED_LINK_HOSTS for exactly this).
 */
export function googleMapsWalkUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

/** "Hi, is Maria home?" or, with no usable first name, "Hi, is the homeowner home?". */
export function greetingFor(ownerFirstName: string | null): string {
  const name = ownerFirstName?.trim();
  return name ? `Hi, is ${name} home?` : "Hi, is the homeowner home?";
}

/** "$40 leaf cleanup" for a priced house; "Leaf cleanup: quote on site" otherwise. Crew never see owner-only wording. */
export function quoteLine(quoteLabel: string, serviceLabel: string): string {
  const service = serviceLabel.trim();
  const label = quoteLabel.trim();
  if (label.startsWith("$")) return `${label} ${service.toLowerCase()}`.trim();
  const shown = /quote on site/i.test(label) ? "quote on site" : "price to be set";
  return service ? `${service}: ${shown}` : shown;
}

export type WalkProgress = {
  /** 1-based house number being shown, never past `total`. */
  current: number;
  total: number;
  handled: number;
  booked: number;
  /** 0..1 for the bar. */
  fraction: number;
  /** "8 of 25 · 2 booked" (the booked part only once there is one). */
  label: string;
};

export function walkProgress(input: { total: number; handled: number; booked: number }): WalkProgress {
  const total = Math.max(0, Math.floor(input.total));
  const handled = Math.min(total, Math.max(0, Math.floor(input.handled)));
  const booked = Math.max(0, Math.floor(input.booked));
  const current = total === 0 ? 0 : Math.min(total, handled + 1);
  const fraction = total === 0 ? 0 : handled / total;
  const label = `${current} of ${total}${booked > 0 ? ` · ${booked} booked` : ""}`;
  return { current, total, handled, booked, fraction, label };
}

/**
 * The next house still to do, going forward from `from` and wrapping to houses that were skipped earlier.
 * `from` is the index just handled or skipped (-1 for the start). Null when every house is done.
 */
export function nextStopIndex(stops: readonly { id: string }[], done: ReadonlySet<string>, from: number): number | null {
  const n = stops.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + step) % n) + n) % n;
    if (!done.has(stops[i].id)) return i;
  }
  return null;
}

/** Re-plan: drop houses already logged this session and renumber the rest 1..n in their walking order. */
export function excludeLogged(stops: readonly WalkStopView[], logged: ReadonlySet<string>): WalkStopView[] {
  return stops.filter((s) => !logged.has(s.id)).map((s, i) => ({ ...s, order: i + 1 }));
}

export const COME_BACK_OPTIONS = ["Weekday evenings", "Weekends"] as const;

/** The words saved as the knock's callback_window; empty or blank means nothing to save. */
export function callbackWindowText(choice: (typeof COME_BACK_OPTIONS)[number] | "custom", custom = ""): string | null {
  if (choice !== "custom") return choice;
  const t = custom.replace(/\s+/g, " ").trim().slice(0, 200);
  return t || null;
}
