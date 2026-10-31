/**
 * Turns rows (parcels + block groups + knocks + customers + settings) into `ParcelView`s: the simple score, quotes,
 * median income and last knock. Pure (no next/* or db imports) so it is unit-tested with fixtures;
 * lib/canvass/load.ts feeds it from the database.
 *
 * Simple-score inputs: the lot-size tier from the quote, how close an existing customer is (adjacent within
 * `neighbor_n` houses / near within 150 m / same street / none) and whether the owner lives there.
 */
import type { BlockGroup, CanvassSettings, Knock, KnockOutcome, Parcel } from "../db/types";
import { fullAddress, ownerFirstName } from "./address";
import { estimateTurf, quotesForAll, turfSource } from "./quote";
import { nearCustomerLevel } from "./score";
import type { CustomerPoint } from "./score";
import type { SeasonFocus } from "./season";
import { simpleScore } from "./simple-score";
import type { NearCustomer, SimpleScore } from "./simple-score";
import type { ParcelView } from "./views";

/** The customers columns the assembler reads. */
export type CustomerRef = { id: string; address: string | null; lat: number | null; lng: number | null; parcel_id: string | null };

/** A knock row joined to nothing: the assembler only needs these columns. */
export type KnockRef = Pick<Knock, "id" | "parcel_id" | "knocked_at" | "outcome" | "knocker_id" | "pitch_id">;

/** The block-group columns the assembler reads. */
export type BlockGroupRef = Pick<BlockGroup, "geoid"> & Partial<Pick<BlockGroup, "median_hh_income">>;

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
};

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

/** A do-not-knock house scores nothing. */
const dnkScore = (s: SimpleScore): SimpleScore => ({
  ...s,
  points: 0,
  label: "low",
  emoji: "➖",
  reasons: [],
  breakdown: { lawn: 0, customer: 0, owner: 0 },
});

/** Everything a parcel needs for its view. */
export function assembleOne(
  parcel: Parcel,
  input: Omit<AssembleInput, "parcels" | "knocks"> & { summary?: { last: KnockRef; count: number }; parcelsOnStreet?: readonly { address: string }[] },
): ParcelView {
  const { settings, season } = input;
  const blockGroup = parcel.block_group_geoid ? (input.blockGroups.get(parcel.block_group_geoid) ?? null) : null;

  // The estimate is recomputed from the current settings so the quote updates live when hardscape_pct changes.
  const turf_sqft_est = estimateTurf(parcel, settings.hardscape_pct);
  const turfParcel = { ...parcel, turf_sqft_est };
  const quotes = quotesForAll(turfParcel, settings);
  const quote = quotes[season.service];

  const nearCustomer = nearCustomerFor(parcel, input.customers, settings, input.parcelsOnStreet);
  const rawScore = simpleScore(
    {
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
    simple,
    medianIncome: blockGroup?.median_hh_income ?? null,
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
  return input.parcels.map((p) => assembleOne(p, { ...input, summary: summaries.get(p.id), parcelsOnStreet: streets.get(p.street.trim().toUpperCase()) }));
}
