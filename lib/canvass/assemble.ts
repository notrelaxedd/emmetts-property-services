/**
 * Turns rows (parcels + block groups + knocks + customers + settings) into `ParcelView`s: resolved window, the
 * knock-now light and plain-English window, the simple score, quotes, last knock and the 7-day strip. Pure (no
 * next/* or db imports) so it is unit-tested with fixtures; lib/canvass/load.ts feeds it from the database.
 *
 * Simple-score inputs: the light (now, or the owner's chosen slot), the lot-size tier from the quote, how close an
 * existing customer is (adjacent within `neighbor_n` houses / near within 150 m / same street / none) and whether
 * the owner lives there. The learned layer (knocks pooled per block group or street) only feeds the lights.
 */
import type { BlockGroup, CanvassSettings, Knock, KnockOutcome, Parcel } from "../db/types";
import { fullAddress, ownerFirstName } from "./address";
import { knockNow, plainWindow, weekStrip } from "./lights";
import type { KnockNow } from "./lights";
import { estimateTurf, quotesForAll, turfSource } from "./quote";
import { nearCustomerLevel } from "./score";
import type { CustomerPoint } from "./score";
import type { SeasonFocus } from "./season";
import { simpleScore } from "./simple-score";
import type { NearCustomer, SimpleScore } from "./simple-score";
import type { TimeWindow } from "./types";
import { CANVASS_TZ, learnedWindow, resolveWindow } from "./windows";
import type { LearnedWindow } from "./windows";
import type { ParcelView } from "./views";

/** The customers columns the assembler reads. */
export type CustomerRef = { id: string; address: string | null; lat: number | null; lng: number | null; parcel_id: string | null };

/** A knock row joined to nothing: the assembler only needs these columns. */
export type KnockRef = Pick<Knock, "id" | "parcel_id" | "knocked_at" | "outcome" | "knocker_id" | "pitch_id">;

/** The block-group columns the assembler reads; everything past the prior window is optional (older callers). */
export type BlockGroupRef = Pick<BlockGroup, "geoid" | "prior_window"> &
  Partial<Pick<BlockGroup, "median_hh_income" | "pct_not_in_lf" | "pct_hh_nonworking_parent" | "commute_dist" | "depart_dist">>;

/** A chosen time to judge the light in (the owner's slot picker); without one the light is for "now". */
export type ScoreSlot = { at: Date };

export type AssembleInput = {
  parcels: readonly Parcel[];
  /** By GEOID. */
  blockGroups: ReadonlyMap<string, BlockGroupRef>;
  /** Knocks for the parcels being assembled (any order). */
  knocks: readonly KnockRef[];
  /** profiles.id → name, for `lastKnock.knocker_name`. */
  knockerNames: ReadonlyMap<string, string>;
  customers: readonly CustomerRef[];
  settings: CanvassSettings;
  season: SeasonFocus;
  /** Learned windows keyed by `learnedGroupKey(parcel)` (see `learnedWindowsFor`). */
  learned?: ReadonlyMap<string, LearnedWindow | null>;
  /** The time to judge the light in; defaults to `now`. */
  slot?: ScoreSlot | null;
  /** "Now" for the light when no slot is given; defaults to the real clock. */
  now?: Date;
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

// ---------- Customers ----------

/** The customers as `nearCustomerLevel` wants them. */
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

/** How close an existing customer is to one parcel (adjacent / near / street / none), ignoring the parcel's own customer row. */
export function nearCustomerFor(
  parcel: Pick<Parcel, "address" | "street" | "centroid_lat" | "centroid_lng" | "customer_id" | "parcel_id">,
  customers: readonly CustomerRef[],
  settings: Pick<CanvassSettings, "neighbor_n">,
  parcelsOnStreet?: readonly { address: string }[],
): NearCustomer {
  const others = customers.filter((c) => !isOwnCustomer(parcel, c));
  return nearCustomerLevel(parcel, customerPoints(others), settings.neighbor_n, parcelsOnStreet);
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

const NO_KNOCK: KnockNow = { light: "red", label: "Do not knock", nextGoodTime: null, nextGoodAt: null };

/** A do-not-knock house scores nothing whatever its light. */
const dnkScore = (s: SimpleScore): SimpleScore => ({
  ...s,
  points: 0,
  label: "low",
  emoji: "➖",
  reasons: [],
  breakdown: { time: 0, lawn: 0, customer: 0, owner: 0 },
});

/** Everything a parcel needs for its view. */
export function assembleOne(
  parcel: Parcel,
  input: Omit<AssembleInput, "parcels" | "knocks"> & { summary?: { last: KnockRef; count: number }; parcelsOnStreet?: readonly { address: string }[] },
): ParcelView {
  const { settings, season } = input;
  const blockGroup = parcel.block_group_geoid ? (input.blockGroups.get(parcel.block_group_geoid) ?? null) : null;
  const learned = input.learned?.get(learnedGroupKey(parcel)) ?? null;
  const window = resolveWindow({ parcel, blockGroup, learned, settings });
  const at = input.slot?.at ?? input.now ?? new Date();

  // The estimate is recomputed from the current settings so the quote updates live when hardscape_pct changes.
  const turf_sqft_est = estimateTurf(parcel, settings.hardscape_pct);
  const turfParcel = { ...parcel, turf_sqft_est };
  const quotes = quotesForAll(turfParcel, settings);
  const quote = quotes[season.service];

  const knock = parcel.do_not_knock ? NO_KNOCK : knockNow(window.window, at, CANVASS_TZ, learned);
  const plain = plainWindow(
    window,
    blockGroup
      ? {
          pct_not_in_lf: blockGroup.pct_not_in_lf ?? null,
          pct_hh_nonworking_parent: blockGroup.pct_hh_nonworking_parent ?? null,
          commute_dist: blockGroup.commute_dist ?? {},
          depart_dist: blockGroup.depart_dist ?? {},
        }
      : null,
    parcel,
  );
  const nearCustomer = nearCustomerFor(parcel, input.customers, settings, input.parcelsOnStreet);
  const rawScore = simpleScore(
    {
      light: knock.light,
      tier: quote.tier,
      turfSqft: quote.turfSqft,
      nearCustomer,
      ownerOccupied: parcel.owner_occupied,
      ownerIsEntity: parcel.owner_is_entity,
    },
    settings.score_weights,
  );
  const simple = parcel.do_not_knock ? dnkScore(rawScore) : rawScore;

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
    fullAddress: fullAddress(parcel),
    ownerFirstName: ownerFirstName(parcel.owner_display),
    window,
    knock,
    plain,
    simple,
    medianIncome: blockGroup?.median_hh_income ?? null,
    strip: weekStrip(window.window, learned),
    quote,
    quotes,
    lastKnock,
    knockCount: summary?.count ?? 0,
    isCustomer,
    turfSource: turfSource(turfParcel),
  };
}

/** Every parcel's view (do-not-knock houses score 0). */
export function assembleParcelViews(input: AssembleInput): ParcelView[] {
  const summaries = knockSummary(input.knocks);
  const streets = parcelsByStreet(input.parcels);
  const learned = input.learned ?? learnedWindowsFor(input.parcels, input.knocks, input.blockGroups, input.settings);
  const now = input.now ?? new Date();
  return input.parcels.map((p) =>
    assembleOne(p, { ...input, now, learned, summary: summaries.get(p.id), parcelsOnStreet: streets.get(p.street.trim().toUpperCase()) }),
  );
}
