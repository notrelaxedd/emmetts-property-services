/**
 * Season-aware pitch: which service the crew leads with this month, the one-line door pitch and the default
 * offer printed on hangers. Pure: no next/* or db imports (Intl only for "which month is it in Ohio").
 *
 * The month → service map lives in `canvass_settings.season_map` (owner-editable); the default is Sep–Nov leaf
 * cleanup, Dec–Mar snow removal (+ spring mowing pre-sale), Apr–Aug mowing & edging.
 */
import { DEFAULT_SEASON_MAP, SERVICE_KEYS } from "./types";
import type { SeasonMap, ServiceKey } from "./types";

export { DEFAULT_SEASON_MAP };
/** Alias kept for callers that prefer the lower-case name. */
export const defaultSeasonMap: SeasonMap = DEFAULT_SEASON_MAP;

export const SEASON_TZ = "America/New_York";

export type SeasonFocus = {
  service: ServiceKey;
  /** Headline for the logger / hanger, e.g. "Leaf cleanup". */
  label: string;
  /** One line the crew can say at the door. */
  pitch: string;
  /** Default offer copy for the hanger (canvass_settings.offer_text overrides it). */
  offer: string;
};

export const SEASON_LABELS: Record<ServiceKey, string> = {
  mow: "Mowing & edging",
  edge: "Edging",
  leaf_cleanup: "Leaf cleanup",
  gutters: "Gutter cleaning",
  snow: "Snow removal + spring mowing pre-sale",
};

export const SEASON_PITCHES: Record<ServiceKey, string> = {
  mow: "We mow a few lawns on this street already — can I leave you a quick price for weekly mowing and edging?",
  edge: "We're edging driveways and walks on this street this week — want a price for a clean line?",
  leaf_cleanup: "Leaves are coming down — we're doing cleanups on this street; want a quick price before the first snow?",
  gutters: "We're clearing gutters on this street before the freeze — can I give you a quick price?",
  snow: "We're lining up snow removal for this street — lock in a season rate now and get early pricing on spring mowing.",
};

export const SEASON_OFFERS: Record<ServiceKey, string> = {
  mow: "Neighbor rate: first cut half price when you sign up for weekly mowing.",
  edge: "Add edging to any mow at the neighbor rate.",
  leaf_cleanup: "Neighbor rate on leaf cleanup: book before the first snow.",
  gutters: "Gutter cleaning at the neighbor rate, downspout check included.",
  snow: "Season snow rate locked in now, plus early pricing on spring mowing.",
};

const isService = (v: unknown): v is ServiceKey => typeof v === "string" && (SERVICE_KEYS as string[]).includes(v);

/** Any number → a month 1–12 (13 wraps to 1, 0 to 12); non-numbers → January. */
export function normalizeMonth(month: number): number {
  if (!Number.isFinite(month)) return 1;
  const m = Math.round(month);
  return ((((m - 1) % 12) + 12) % 12) + 1;
}

/** The featured service for a month; unknown / missing map entries fall back to the default map. */
export function seasonService(month: number, seasonMap: Partial<SeasonMap> | null | undefined = DEFAULT_SEASON_MAP): ServiceKey {
  const key = String(normalizeMonth(month));
  const v = seasonMap?.[key];
  return isService(v) ? v : DEFAULT_SEASON_MAP[key];
}

/** Service, label, door pitch and default offer for a month. */
export function seasonFocus(month: number, seasonMap: Partial<SeasonMap> | null | undefined = DEFAULT_SEASON_MAP): SeasonFocus {
  const service = seasonService(month, seasonMap);
  return { service, label: SEASON_LABELS[service], pitch: SEASON_PITCHES[service], offer: SEASON_OFFERS[service] };
}

/** Month (1–12) of an instant in the crew's time zone. */
export function monthIn(date: Date = new Date(), timezone = SEASON_TZ): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "numeric" }).format(date);
  return normalizeMonth(Number.parseInt(part, 10));
}

/** Today's season focus (Ohio time). */
export function currentSeasonFocus(seasonMap: Partial<SeasonMap> | null | undefined = DEFAULT_SEASON_MAP, now: Date = new Date()): SeasonFocus {
  return seasonFocus(monthIn(now), seasonMap);
}
