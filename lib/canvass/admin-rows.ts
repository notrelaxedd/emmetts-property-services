/**
 * Pure helpers for the owner's Canvass pages: the slim rows the parcel table and the area map receive (no `raw`,
 * no polygons in the table), labels for enums, number formatting and the quintile colour scale. No React, no
 * next/*, no db: safe to import from server components and client islands alike.
 */
import type { HomePattern, KnockOutcome } from "../db/types";
import { scoreColor as labelColor } from "./simple-score";
import type { ScoreLabel } from "./simple-score";
import type { ParcelGeom, TierKey } from "./types";
import type { ParcelView } from "./views";

/** One table row: everything the list shows, nothing heavy. Owner pages only (it carries points and profit). */
export type ParcelRow = {
  id: string;
  parcel_id: string;
  address: string;
  /** "1234 Lakeview Ave, Rocky River, OH 44116". */
  fullAddress: string;
  street: string;
  owner_display: string | null;
  ownerFirstName: string | null;
  owner_is_entity: boolean;
  lot_sqft: number | null;
  turf_sqft: number | null;
  turfSource: "traced" | "estimate" | null;
  tier: TierKey | null;
  market_value: number | null;
  owner_occupied: boolean | null;
  /** Simple score: points 0..9, hot / good / low, the reasons joined with " · " and the three factors. */
  scorePoints: number;
  scoreLabel: ScoreLabel;
  scoreEmoji: string;
  scoreReason: string;
  scoreBreakdown: { lawn: number; customer: number; owner: number };
  /** The season service's quote: "$40" | "Quote on site" | "Owner to fill in" | "Lot size unknown". */
  quoteLabel: string;
  quotePrice: number | null;
  laborCost: number | null;
  profit: number | null;
  underCost: boolean;
  medianIncome: number | null;
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
  /** hot = brand green, good = amber, low = gray (see `scoreColor`). */
  label: ScoreLabel;
  do_not_knock: boolean;
  isCustomer: boolean;
};

export function toParcelRow(v: ParcelView): ParcelRow {
  const reasons = v.simple.reasons.join(" · ");
  return {
    id: v.id,
    parcel_id: v.parcel_id,
    address: v.address,
    fullAddress: v.fullAddress,
    street: v.street,
    owner_display: v.owner_display,
    ownerFirstName: v.ownerFirstName,
    owner_is_entity: v.owner_is_entity,
    lot_sqft: v.lot_sqft,
    turf_sqft: v.turf_sqft_traced ?? v.turf_sqft_est,
    turfSource: v.turfSource,
    tier: v.quote.tier,
    market_value: v.market_value,
    owner_occupied: v.owner_occupied,
    scorePoints: v.simple.points,
    scoreLabel: v.simple.label,
    scoreEmoji: v.simple.emoji,
    scoreReason: reasons.charAt(0).toUpperCase() + reasons.slice(1),
    scoreBreakdown: v.simple.breakdown,
    quoteLabel: v.quote.label,
    quotePrice: v.quote.price,
    laborCost: v.quote.laborCost,
    profit: v.quote.profit,
    underCost: v.quote.underCost,
    medianIncome: v.medianIncome,
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
  return { id: v.id, geom: v.geom, label: v.simple.label, do_not_knock: v.do_not_knock, isCustomer: v.isCustomer };
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

/** "Yes" / "No" / "?" for a nullable boolean. */
export function yesNo(v: boolean | null | undefined): string {
  return v === true ? "Yes" : v === false ? "No" : "?";
}

// ---------- Colour scale ----------

/** Map colour for a score label: hot "#65C435" (brand green), good "#F59E0B" (amber), low "#9A9E9C" (gray). */
export const scoreColor = (label: ScoreLabel): string => labelColor(label);

export const DO_NOT_KNOCK_COLOR = "#DC2626";
export const CUSTOMER_COLOR = "#2563EB";

// ---------- Geometry for Leaflet ----------

export type LatLng = [lat: number, lng: number];

/** GeoJSON rings ([lng, lat]) to Leaflet rings ([lat, lng]); a MultiPolygon yields one entry per polygon. */
export function geomToLatLngs(geom: ParcelGeom): LatLng[][][] {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LatLng)));
}

/** True when two bounds (from `boundsOf`) are the same box, or both null. */
export function sameBounds(a: [LatLng, LatLng] | null, b: [LatLng, LatLng] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0][0] === b[0][0] && a[0][1] === b[0][1] && a[1][0] === b[1][0] && a[1][1] === b[1][1];
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
