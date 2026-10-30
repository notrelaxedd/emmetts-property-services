/**
 * View types shared by the Canvass server loaders (lib/canvass/load.ts) and every page / client island that renders
 * them. Pure types only: no next/* or db imports beyond the row types.
 */
import type { CanvassPlan, CanvassSettings, HangerCode, Knock, KnockOutcome, Parcel, Pitch } from "../db/types";
import type { HangerConversion } from "./hangers";
import type { SeasonFocus } from "./season";
import type { KnockStatRow } from "./stats";
import type { CanvassSummaryContent, QuoteRange, ScoreBreakdown, ServiceKey, WindowResult } from "./types";

/** A parcel with everything the map, table and detail page show: window, quotes, score, last knock. */
export type ParcelView = Parcel & {
  window: WindowResult;
  /** For the current season service. */
  quote: QuoteRange;
  quotes: Record<ServiceKey, QuoteRange>;
  score: number;
  breakdown: ScoreBreakdown;
  /** 0 (lowest) .. 4 (highest), among the parcels loaded together. */
  quintile: number;
  lastKnock: { knocked_at: string; outcome: KnockOutcome; knocker_name: string } | null;
  knockCount: number;
  isCustomer: boolean;
  turfSource: "traced" | "estimate" | null;
};

export type KnockView = Knock & { knocker_name: string; pitch_name: string | null; address: string };

export type PlanStopView = {
  id: string;
  order: number;
  address: string;
  owner_display: string | null;
  street: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
  window: WindowResult;
  quote: QuoteRange;
  score: number;
  walkMeters: number;
};

export type PlanView = {
  stops: PlanStopView[];
  totalMeters: number;
  excluded: { dnk: number; recent: number; noOverlap: number };
  counts: { candidates: number; taken: number };
  slot: { date: string; start: string; end: string };
};

/** What the knock logger needs per house near the crew's position. */
export type NearbyParcel = Pick<
  Parcel,
  | "id"
  | "parcel_id"
  | "address"
  | "street"
  | "owner_display"
  | "owner_is_entity"
  | "geom"
  | "centroid_lat"
  | "centroid_lng"
  | "do_not_knock"
  | "callback_window"
  | "home_pattern"
> & {
  window: WindowResult;
  quote: QuoteRange;
  /** "$45–$60" */
  quoteLabel: string;
  lastKnock: ParcelView["lastKnock"];
  isCustomer: boolean;
  /** Metres from the crew's position (0 for a text search). */
  meters: number;
};

export type SummaryView = { for_date: string; summary: CanvassSummaryContent; created_at: string };

export type ParcelViewsResult = { parcels: ParcelView[]; settings: CanvassSettings; season: SeasonFocus; customersCount: number };

export type ParcelDetailResult = { parcel: ParcelView; knocks: KnockView[]; settings: CanvassSettings; season: SeasonFocus };

export type CanvassStatsResult = {
  byKnocker: KnockStatRow[];
  byPitch: KnockStatRow[];
  hangers: HangerConversion[];
  pitches: Pitch[];
  totals: { knocks: number; parcels: number; doNotKnock: number; customers: number };
};

export type StreetRow = { street: string; parcels: number; block_group_geoid: string | null; code: HangerCode | null };

export type TodayPlanResult = { plan: CanvassPlan; stops: PlanStopView[] };
