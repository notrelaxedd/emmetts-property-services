/**
 * Pure helpers for the owner's Canvass pages: the slim rows the parcel table and the area map receive (no `raw`,
 * no polygons in the table), labels for enums, number formatting and the quintile colour scale. No React, no
 * next/*, no db: safe to import from server components and client islands alike.
 */
import type { HomePattern, KnockOutcome } from "../db/types";
import type { ParcelGeom, WindowSource } from "./types";
import type { ParcelView } from "./views";

/** One table row: everything the list shows, nothing heavy. */
export type ParcelRow = {
  id: string;
  parcel_id: string;
  address: string;
  street: string;
  owner_display: string | null;
  owner_is_entity: boolean;
  lot_sqft: number | null;
  turf_sqft: number | null;
  turfSource: "traced" | "estimate" | null;
  market_value: number | null;
  owner_occupied: boolean | null;
  windowLabel: string;
  windowReason: string;
  windowSource: WindowSource;
  quoteLow: number;
  quoteHigh: number;
  score: number;
  quintile: number;
  lastOutcome: KnockOutcome | null;
  lastKnockAt: string | null;
  knockCount: number;
  do_not_knock: boolean;
  isCustomer: boolean;
};

/** What the map draws per parcel; the popup looks the rest up in the table rows by id. */
export type MapParcel = {
  id: string;
  geom: ParcelGeom;
  quintile: number;
  do_not_knock: boolean;
  isCustomer: boolean;
};

export function toParcelRow(v: ParcelView): ParcelRow {
  return {
    id: v.id,
    parcel_id: v.parcel_id,
    address: v.address,
    street: v.street,
    owner_display: v.owner_display,
    owner_is_entity: v.owner_is_entity,
    lot_sqft: v.lot_sqft,
    turf_sqft: v.turf_sqft_traced ?? v.turf_sqft_est,
    turfSource: v.turfSource,
    market_value: v.market_value,
    owner_occupied: v.owner_occupied,
    windowLabel: v.window.label,
    windowReason: v.window.reason,
    windowSource: v.window.source,
    quoteLow: v.quote.low,
    quoteHigh: v.quote.high,
    score: v.score,
    quintile: v.quintile,
    lastOutcome: v.lastKnock?.outcome ?? null,
    lastKnockAt: v.lastKnock?.knocked_at ?? null,
    knockCount: v.knockCount,
    do_not_knock: v.do_not_knock,
    isCustomer: v.isCustomer,
  };
}

/** Null for parcels without a polygon (they still show in the table). */
export function toMapParcel(v: ParcelView): MapParcel | null {
  if (!v.geom) return null;
  return { id: v.id, geom: v.geom, quintile: v.quintile, do_not_knock: v.do_not_knock, isCustomer: v.isCustomer };
}

// ---------- Labels ----------

export const OUTCOME_LABELS: Record<KnockOutcome, string> = {
  no_answer: "No answer",
  not_interested: "Not interested",
  quote_given: "Quote given",
  booked: "Booked",
  call_back: "Call back",
  no_soliciting: "No Soliciting sign",
  do_not_return: "Asked not to return",
  has_service: "Already has service",
};

export const HOME_PATTERN_LABELS: Record<HomePattern, string> = {
  home_weekdays: "Home weekdays",
  evenings_only: "Evenings only",
  weekends_only: "Weekends only",
  unknown: "Unknown",
};

export const WINDOW_SOURCE_LABELS: Record<WindowSource, string> = {
  homeowner: "Homeowner said",
  crew: "Crew observed",
  learned: "Learned from knocks",
  acs: "Area estimate",
  none: "No data yet",
};

export const outcomeLabel = (outcome: KnockOutcome | null | undefined): string => (outcome ? OUTCOME_LABELS[outcome] ?? outcome : "Not knocked");

// ---------- Formatting ----------

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "12,400" or "" for unknown. */
export function formatSqft(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? intFormat.format(Math.round(n)) : "";
}

/** "$245,000" or "" for unknown. */
export function formatMoney(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `$${intFormat.format(Math.round(n))}` : "";
}

/** "$45–$60" (en dash, a range). */
export function formatQuote(low: number, high: number): string {
  return `$${Math.round(low)}–$${Math.round(high)}`;
}

/** "Yes" / "No" / "?" for a nullable boolean. */
export function yesNo(v: boolean | null | undefined): string {
  return v === true ? "Yes" : v === false ? "No" : "?";
}

/** Tiny percent label for the score popover: "32%". */
export function percentLabel(p: number): string {
  return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

// ---------- Colour scale ----------

/** Quintile 0 (lowest) gray through quintile 4 (highest) brand green. */
export const QUINTILE_COLORS = ["#9A9E9C", "#B5C7A0", "#9FD279", "#65C435", "#327213"] as const;

export function scoreColor(quintile: number): string {
  const q = Number.isFinite(quintile) ? Math.max(0, Math.min(QUINTILE_COLORS.length - 1, Math.round(quintile))) : 0;
  return QUINTILE_COLORS[q];
}

export const DO_NOT_KNOCK_COLOR = "#DC2626";
export const CUSTOMER_COLOR = "#2563EB";

// ---------- Geometry for Leaflet ----------

export type LatLng = [lat: number, lng: number];

/** GeoJSON rings ([lng, lat]) to Leaflet rings ([lat, lng]); a MultiPolygon yields one entry per polygon. */
export function geomToLatLngs(geom: ParcelGeom): LatLng[][][] {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LatLng)));
}

/** [[minLat, minLng], [maxLat, maxLng]] over every parcel polygon, or null when nothing has geometry. */
export function boundsOf(parcels: readonly { geom: ParcelGeom }[]): [LatLng, LatLng] | null {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const p of parcels) {
    for (const poly of geomToLatLngs(p.geom)) {
      for (const ring of poly) {
        for (const [lat, lng] of ring) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
      }
    }
  }
  return Number.isFinite(minLat) && Number.isFinite(minLng) ? [[minLat, minLng], [maxLat, maxLng]] : null;
}
