/**
 * View types shared by the Canvass server loaders (lib/canvass/load.ts) and every page / client island that renders
 * them. Pure types only: no next/* or db imports beyond the row types.
 */
import type { CanvassPlan, CanvassSettings, HangerCode, Knock, KnockOutcome, Parcel, Pitch } from "../db/types";
import type { HangerConversion } from "./hangers";
import type { KnockNow, Light, StripDay } from "./lights";
import type { SeasonFocus } from "./season";
import type { SimpleScore } from "./simple-score";
import type { KnockStatRow } from "./stats";
import type { CanvassSummaryContent, Quote, ServiceKey, WindowResult } from "./types";
import type { WalkCounts } from "./walk";

/** A parcel with everything the map, list and detail page show: window, light, simple score, quotes, last knock. */
export type ParcelView = Parcel & {
  /** "1234 Lakeview Ave, Rocky River, OH 44116". */
  fullAddress: string;
  /** "Maria" for a greeting; null when the county owner name has no usable first name. */
  ownerFirstName: string | null;
  window: WindowResult;
  /** The light for "now" (or for the requested slot) with the next good time. */
  knock: KnockNow;
  /** What the crew reads: the window in plain English and why. */
  plain: { text: string; reason: string };
  /** Points, label and reasons (owner pages may show the breakdown; crew never sees points). */
  simple: SimpleScore;
  /** Block-group median household income (Census area, not this household); null when unknown. */
  medianIncome: number | null;
  /** The 7-day strip (Mon..Sun) of coloured hour blocks. */
  strip: StripDay[];
  /** For the current season service. */
  quote: Quote;
  quotes: Record<ServiceKey, Quote>;
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
  fullAddress: string;
  owner_display: string | null;
  street: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
  window: WindowResult;
  knock: KnockNow;
  /** The window in plain English and why (shown next to the light). */
  plain: { text: string; reason: string };
  quote: Quote;
  /** Simple-score points (0..12); owner pages only. */
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

/** One house on a Walk Mode route: only what the crew card shows (no score points, profit or labor cost). */
export type WalkStopView = {
  id: string;
  /** 1-based walking order. */
  order: number;
  fullAddress: string;
  ownerFirstName: string | null;
  lat: number;
  lng: number;
  /** The season pitch one-liner. */
  pitch: string;
  /** The featured service's quote label ("$40 ..." price text). */
  quoteLabel: string;
  light: Light;
  callback_window: string | null;
  /** Metres from the previous stop (the start for the first). */
  walkMeters: number;
};

export type WalkResultView = {
  stops: WalkStopView[];
  totalMeters: number;
  counts: WalkCounts;
  season: { service: ServiceKey; label: string; pitch: string };
  pitches: Pick<Pitch, "id" | "name" | "script">[];
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
