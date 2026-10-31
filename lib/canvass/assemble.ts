/**
 * Turns rows (parcels + block groups + knocks + customers + settings) into `ParcelView`s: resolved window, quotes,
 * priority score and quintile. Pure (no next/* or db imports) so it is unit-tested with fixtures; lib/canvass/load.ts
 * feeds it from the database.
 *
 * Scoring inputs:
 *   pAnswer       the learned bucket's posterior mean for the slot when the group has enough knocks, else the prior
 *                 bucket's mean from `answerProbability` on an empty bucket (prior bucket when the slot is inside the
 *                 house's window, the "other" prior otherwise);
 *   pConvert      `convertProbability` from the model fitted on the whole knock log;
 *   value         the season service's quote mid;
 *   neighborBoost existing customers (lat/lng or same street) near the house.
 */
import type { BlockGroup, CanvassSettings, Knock, KnockOutcome, Parcel } from "../db/types";
import { estimateTurf, quoteRangesForAll, turfSource } from "./quote";
import { convertProbability, fitConvertModel, lotBand, neighborBoost, priorityScore, scoreQuintile } from "./score";
import type { ConvertModel, ConvertRow, CustomerPoint } from "./score";
import type { SeasonFocus } from "./season";
import type { TimeWindow } from "./types";
import { answerProbability, learnedBucketAt, learnedWindow, resolveWindow, windowOverlapsSlot } from "./windows";
import type { LearnedWindow } from "./windows";
import type { ParcelView } from "./views";

/** The customers columns the assembler reads. */
export type CustomerRef = { id: string; address: string | null; lat: number | null; lng: number | null; parcel_id: string | null };

/** A knock row joined to nothing: the assembler only needs these columns. */
export type KnockRef = Pick<Knock, "id" | "parcel_id" | "knocked_at" | "outcome" | "knocker_id" | "pitch_id">;

/** The slot P(answer) is judged in: a local weekday (0 = Sunday) and hour (0–23). */
export type ScoreSlot = { weekday: number; hour: number };

export type AssembleInput = {
  parcels: readonly Parcel[];
  /** By GEOID. */
  blockGroups: ReadonlyMap<string, Pick<BlockGroup, "geoid" | "prior_window">>;
  /** Knocks for the parcels being assembled (any order). */
  knocks: readonly KnockRef[];
  /** profiles.id → name, for `lastKnock.knocker_name`. */
  knockerNames: ReadonlyMap<string, string>;
  customers: readonly CustomerRef[];
  settings: CanvassSettings;
  season: SeasonFocus;
  /** Fitted on the whole knock log (see `convertRowsFrom` + `fitConvertModel`). */
  model: ConvertModel;
  /** Learned windows keyed by `learnedGroupKey(parcel)` (see `learnedWindowsFor`). */
  learned?: ReadonlyMap<string, LearnedWindow | null>;
  /** The slot to judge P(answer) in; defaults to a representative slot inside each house's own window. */
  slot?: ScoreSlot | null;
};

// ---------- Grouping ----------

/** Knocks are pooled per block group for the learned layer; parcels without a block group pool per street. */
export function learnedGroupKey(parcel: Pick<Parcel, "block_group_geoid" | "street">): string {
  return parcel.block_group_geoid ? `bg:${parcel.block_group_geoid}` : `street:${parcel.street.trim().toUpperCase()}`;
}

/**
 * One learned window per group (block group or street), from the knocks on the given parcels, shrunk toward that
 * block group's ACS prior. A group with fewer than `learned_min_knocks` knocks maps to null.
 */
export function learnedWindowsFor(
  parcels: readonly Pick<Parcel, "id" | "block_group_geoid" | "street">[],
  knocks: readonly Pick<KnockRef, "parcel_id" | "knocked_at" | "outcome">[],
  blockGroups: ReadonlyMap<string, Pick<BlockGroup, "prior_window">>,
  settings: Pick<CanvassSettings, "learned_min_knocks">,
): Map<string, LearnedWindow | null> {
  const keyByParcel = new Map<string, string>();
  const priorByKey = new Map<string, TimeWindow | null>();
  for (const p of parcels) {
    const key = learnedGroupKey(p);
    keyByParcel.set(p.id, key);
    if (!priorByKey.has(key)) priorByKey.set(key, (p.block_group_geoid && blockGroups.get(p.block_group_geoid)?.prior_window?.window) || null);
  }
  const byKey = new Map<string, Pick<Knock, "knocked_at" | "outcome">[]>();
  for (const k of knocks) {
    const key = keyByParcel.get(k.parcel_id);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push({ knocked_at: k.knocked_at, outcome: k.outcome });
    byKey.set(key, list);
  }
  const out = new Map<string, LearnedWindow | null>();
  priorByKey.forEach((prior, key) => {
    out.set(key, learnedWindow(byKey.get(key) ?? [], prior, settings.learned_min_knocks));
  });
  return out;
}

// ---------- Conversion model rows ----------

/** The customers as `neighborBoost` wants them. */
export function customerPoints(customers: readonly CustomerRef[]): CustomerPoint[] {
  return customers.map((c) => ({ address: c.address, lat: c.lat, lng: c.lng }));
}

/** True when a customer row is this parcel's own customer (its id or county PIN). */
const isOwnCustomer = (parcel: Pick<Parcel, "customer_id" | "parcel_id">, c: CustomerRef): boolean =>
  (parcel.customer_id !== null && c.id === parcel.customer_id) || (c.parcel_id !== null && c.parcel_id === parcel.parcel_id);

/** Parcels sharing the street, for the "within N houses" rule. */
function parcelsByStreet<T extends Pick<Parcel, "street" | "address">>(parcels: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const p of parcels) {
    const key = p.street.trim().toUpperCase();
    const list = out.get(key) ?? [];
    list.push(p);
    out.set(key, list);
  }
  return out;
}

/** The neighbor boost for one parcel, ignoring the parcel's own customer row. */
export function neighborBoostFor(
  parcel: Pick<Parcel, "address" | "street" | "centroid_lat" | "centroid_lng" | "customer_id" | "parcel_id">,
  customers: readonly CustomerRef[],
  settings: Pick<CanvassSettings, "neighbor_n">,
  parcelsOnStreet?: readonly { address: string }[],
): number {
  const others = customers.filter((c) => !isOwnCustomer(parcel, c));
  return neighborBoost(parcel, customerPoints(others), settings.neighbor_n, parcelsOnStreet);
}

/**
 * Knock log → rows for `fitConvertModel`. Each knock carries its parcel's lot band, owner-occupied flag, whether a
 * customer was near, the street, the knocker and the pitch. Knocks whose parcel is unknown are skipped.
 */
export function convertRowsFrom(
  knocks: readonly Pick<KnockRef, "parcel_id" | "outcome" | "knocker_id" | "pitch_id">[],
  parcels: readonly Pick<Parcel, "id" | "parcel_id" | "lot_sqft" | "owner_occupied" | "street" | "address" | "centroid_lat" | "centroid_lng" | "customer_id">[],
  customers: readonly CustomerRef[],
  settings: Pick<CanvassSettings, "neighbor_n">,
): ConvertRow[] {
  const byId = new Map(parcels.map((p) => [p.id, p]));
  const streets = parcelsByStreet(parcels);
  const nearCache = new Map<string, boolean>();
  const out: ConvertRow[] = [];
  for (const k of knocks) {
    const p = byId.get(k.parcel_id);
    if (!p) continue;
    let near = nearCache.get(p.id);
    if (near === undefined) {
      near = neighborBoostFor(p, customers, settings, streets.get(p.street.trim().toUpperCase())) > 1;
      nearCache.set(p.id, near);
    }
    out.push({
      outcome: k.outcome,
      lotBand: lotBand(p.lot_sqft),
      ownerOccupied: p.owner_occupied,
      nearCustomer: near,
      street: p.street || null,
      knockerId: k.knocker_id,
      pitchId: k.pitch_id,
    });
  }
  return out;
}

/** `fitConvertModel` over the knock log joined to its parcels. */
export function fitModelFrom(
  knocks: readonly Pick<KnockRef, "parcel_id" | "outcome" | "knocker_id" | "pitch_id">[],
  parcels: Parameters<typeof convertRowsFrom>[1],
  customers: readonly CustomerRef[],
  settings: Pick<CanvassSettings, "neighbor_n">,
): ConvertModel {
  return fitConvertModel(convertRowsFrom(knocks, parcels, customers, settings));
}

// ---------- P(answer) ----------

/** A slot inside the window: its first weekday (Monday) or Saturday, at the window's start hour (10am for "anytime"). */
export function representativeSlot(window: TimeWindow): ScoreSlot {
  const weekday = window.days === "weekends" ? 6 : 1;
  const hour = window.kind === "range" ? window.start : 10;
  return { weekday, hour };
}

/**
 * P(answer) for a house in a slot: the learned bucket's posterior mean when the group has learned anything, else the
 * prior bucket's mean (4/6 inside the house's window, 1/4 outside it) from an empty bucket.
 */
export function answerProbabilityFor(window: TimeWindow, learned: LearnedWindow | null | undefined, slot: ScoreSlot | null | undefined): number {
  const s = slot ?? representativeSlot(window);
  if (learned) {
    const bucket = learnedBucketAt(learned, s);
    if (bucket) return bucket.mean;
  }
  const inside = windowOverlapsSlot(window, { weekday: s.weekday, start: s.hour, end: s.hour + 1 });
  return answerProbability({ knocks: 0, answers: 0, isPrior: inside });
}

// ---------- Assembly ----------

const knockTime = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Latest knock per parcel and the count. */
export function knockSummary(knocks: readonly KnockRef[]): Map<string, { last: KnockRef; count: number }> {
  const out = new Map<string, { last: KnockRef; count: number }>();
  for (const k of knocks) {
    const cur = out.get(k.parcel_id);
    if (!cur) out.set(k.parcel_id, { last: k, count: 1 });
    else {
      cur.count++;
      if (knockTime(k.knocked_at) > knockTime(cur.last.knocked_at)) cur.last = k;
    }
  }
  return out;
}

/** Everything a parcel needs for its view, without the quintile (which depends on the whole set). */
export function assembleOne(parcel: Parcel, input: Omit<AssembleInput, "parcels" | "knocks"> & { summary?: { last: KnockRef; count: number }; parcelsOnStreet?: readonly { address: string }[] }): Omit<ParcelView, "quintile"> {
  const { settings, season } = input;
  const blockGroup = parcel.block_group_geoid ? (input.blockGroups.get(parcel.block_group_geoid) ?? null) : null;
  const learned = input.learned?.get(learnedGroupKey(parcel)) ?? null;
  const window = resolveWindow({ parcel, blockGroup, learned, settings });

  // The estimate is recomputed from the current settings so the quote updates live when hardscape_pct changes.
  const turf_sqft_est = estimateTurf(parcel, settings.hardscape_pct);
  const turfParcel = { ...parcel, turf_sqft_est };
  const quotes = quoteRangesForAll(turfParcel, settings);
  const quote = quotes[season.service];

  const boost = neighborBoostFor(parcel, input.customers, settings, input.parcelsOnStreet);
  const pConvert = convertProbability(
    {
      lotBand: lotBand(parcel.lot_sqft),
      ownerOccupied: parcel.owner_occupied,
      nearCustomer: boost > 1,
      street: parcel.street || null,
      knockerId: null,
      pitchId: null,
    },
    input.model,
  );
  const pAnswer = parcel.do_not_knock ? 0 : answerProbabilityFor(window.window, learned, input.slot);
  const { score, breakdown } = priorityScore({ pAnswer, pConvert, value: quote.mid, neighborBoost: boost });

  const summary = input.summary;
  const lastKnock = summary
    ? {
        knocked_at: summary.last.knocked_at,
        outcome: summary.last.outcome as KnockOutcome,
        knocker_name: input.knockerNames.get(summary.last.knocker_id) ?? "Crew",
      }
    : null;
  const isCustomer = parcel.customer_id !== null || input.customers.some((c) => c.parcel_id !== null && c.parcel_id === parcel.parcel_id);

  return {
    ...turfParcel,
    window,
    quote,
    quotes,
    score: parcel.do_not_knock ? 0 : score,
    breakdown,
    lastKnock,
    knockCount: summary?.count ?? 0,
    isCustomer,
    turfSource: turfSource(turfParcel),
  };
}

/** Every parcel's view, with quintiles computed over the set (do-not-knock houses score 0). */
export function assembleParcelViews(input: AssembleInput): ParcelView[] {
  const summaries = knockSummary(input.knocks);
  const streets = parcelsByStreet(input.parcels);
  const learned = input.learned ?? learnedWindowsFor(input.parcels, input.knocks, input.blockGroups, input.settings);
  const partial = input.parcels.map((p) =>
    assembleOne(p, { ...input, learned, summary: summaries.get(p.id), parcelsOnStreet: streets.get(p.street.trim().toUpperCase()) }),
  );
  const quintiles = scoreQuintile(partial.map((v) => v.score));
  return partial.map((v, i) => ({ ...v, quintile: quintiles[i] ?? 0 }));
}
