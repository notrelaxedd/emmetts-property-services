/**
 * Row factories for canvass unit tests (parcels, block groups, knocks, settings). Values mirror the migration
 * defaults; override what a test cares about.
 */
import { randomUUID } from "node:crypto";
import { CANVASS_SETTINGS_ID } from "../db/types";
import type { BlockGroup, CanvassSettings, Knock, Parcel } from "../db/types";
import {
  DEFAULT_PRICE_TIERS,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_SEASON_MAP,
  DEFAULT_TIER_BOUNDS,
  DEFAULT_TIER_MINUTES,
  emptyParcelFieldMap,
} from "./types";
import type { GeoPolygon } from "./types";

export const T0 = "2026-01-01T00:00:00.000Z";

/** A tiny lot polygon around [lng, lat] (about 17 m × 33 m). */
export const lotAt = (lng: number, lat: number): GeoPolygon => ({
  type: "Polygon",
  coordinates: [
    [
      [lng, lat],
      [lng + 0.0002, lat],
      [lng + 0.0002, lat + 0.0003],
      [lng, lat + 0.0003],
      [lng, lat],
    ],
  ],
});

export function canvassSettingsRow(over: Partial<CanvassSettings> = {}): CanvassSettings {
  return {
    id: CANVASS_SETTINGS_ID,
    created_at: T0,
    updated_at: T0,
    hardscape_pct: 0.12,
    price_tiers: structuredClone(DEFAULT_PRICE_TIERS),
    tier_bounds: { ...DEFAULT_TIER_BOUNDS },
    tier_minutes: structuredClone(DEFAULT_TIER_MINUTES),
    crew_size: 3,
    pay_rate: 15,
    value_tier_enabled: false,
    value_tier_max: 1.1,
    doors_per_hour: 25,
    neighbor_n: 3,
    recency_days: 14,
    daytime_not_in_lf_threshold: 0.4,
    daytime_nonworking_parent_threshold: 0.35,
    work_hours: 8.5,
    learned_min_knocks: 8,
    season_map: { ...DEFAULT_SEASON_MAP },
    residential_land_use_prefixes: ["510", "511", "512", "513", "514", "515", "516", "517", "518", "519"],
    parcel_field_map: emptyParcelFieldMap(),
    acs_vintage: "2023",
    offer_text: null,
    score_weights: { ...DEFAULT_SCORE_WEIGHTS },
    walk_doors: 25,
    ...over,
  };
}

export function parcelRow(over: Partial<Parcel> = {}): Parcel {
  const lng = over.centroid_lng ?? -81.8396;
  const lat = over.centroid_lat ?? 41.4756;
  return {
    id: randomUUID(),
    created_at: T0,
    updated_at: T0,
    parcel_id: `301-12-${Math.floor(Math.random() * 900 + 100)}`,
    address: "19000 DETROIT RD",
    street: "DETROIT RD",
    city: "ROCKY RIVER",
    state: "OH",
    zip: "44116",
    owner_display: "SMITH JOHN",
    mailing_address: "19000 DETROIT RD",
    land_use: "510",
    lot_sqft: 8276.4,
    living_sqft: 1624,
    stories: 1.5,
    footprint_sqft: null,
    year_built: 1956,
    market_value: 285400,
    owner_occupied: true,
    owner_is_entity: false,
    geom: lotAt(lng, lat),
    centroid_lat: lat,
    centroid_lng: lng,
    block_group_geoid: null,
    turf_sqft_est: null,
    turf_sqft_traced: null,
    turf_geom: null,
    callback_window: null,
    home_pattern: null,
    do_not_knock: false,
    do_not_knock_reason: null,
    customer_id: null,
    raw: {},
    fetched_at: T0,
    ...over,
  };
}

export function blockGroupRow(over: Partial<BlockGroup> = {}): BlockGroup {
  return {
    id: randomUUID(),
    created_at: T0,
    updated_at: T0,
    geoid: "390351621021",
    geom: null,
    pct_not_in_lf: 0.3,
    pct_hh_nonworking_parent: 0.2,
    pct_65_plus: 0.2,
    median_hh_income: 85000,
    depart_dist: { "7:00 a.m. to 7:29 a.m.": 100 },
    commute_dist: { "20 to 24 minutes": 100 },
    prior_window: {
      daytimeFriendly: false,
      window: { kind: "range", days: "weekdays", start: 16, end: 18 },
      reason: "Area: typical departure ~7:00am + ~22 min commute + 8.5h → home ~4:30pm",
      pctNotInLf: 0.3,
      pctNonworkingParent: 0.2,
      typicalDepart: 7.25,
      typicalCommute: 22.5,
    },
    acs_vintage: "2023",
    fetched_at: T0,
    ...over,
  };
}

export function knockRow(over: Partial<Knock> = {}): Knock {
  return {
    id: randomUUID(),
    created_at: T0,
    updated_at: T0,
    parcel_id: randomUUID(),
    knocked_at: "2026-10-29T21:15:00.000Z", // Thu 5:15pm in Ohio (EDT)
    knocker_id: "knocker-a",
    outcome: "no_answer",
    pitch_id: null,
    lat: null,
    lng: null,
    weather: null,
    notes: null,
    callback_window: null,
    home_pattern: null,
    quote_low: null,
    quote_high: null,
    lead_id: null,
    quote_id: null,
    client_id: null,
    ...over,
  };
}
