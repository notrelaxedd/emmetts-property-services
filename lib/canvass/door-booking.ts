/**
 * "Quote given" / "Booked" at the door: the customer, lead, quote (+ one custom line) and, for a
 * booking, an unscheduled job. Plain Node (relative imports), service-role `Db`.
 *
 *   customer: parcels.customer_id → customers.parcel_id (county PIN) → normalised address → new row
 *   lead:     source "canvass", utm { source: canvass, medium: door, campaign: <street> }, quoted | won
 *   quote:    sent (+sent_at) for a quote, accepted (+accepted_at) for a booking; price = the house's tier price
 *             (`default_price`, v3) unless the crew typed amounts (then the mid of low/high); 0 when neither exists
 *   item:     is_custom "Door quote: <service>", priced, 1 h
 *   job:      booked only; `ensureJobForQuote` (unscheduled, unpaid) so it lands on the "Needs a day" rail
 *   reprice:  amounts typed in the details sheet after the knock landed (`repriceDoorQuote`)
 */
import type { CanvassSettings, Customer, KnockOutcome, Parcel } from "../db/types";
import { moneyRound } from "../pricing";
import { ensureJobForQuote } from "../ops/jobs";
import { getSettings } from "../ops/settings";
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import { normalizeAddress } from "./county";
import { estimateTurf, quoteFor } from "./quote";
import type { QuoteSettings } from "./quote";
import { SERVICE_LABELS, type ServiceKey } from "./types";

export const DOOR_SOURCE = "canvass";
export const DOOR_EST_HOURS = 1;

export type DoorParcel = Pick<
  Parcel,
  "id" | "parcel_id" | "address" | "street" | "owner_display" | "centroid_lat" | "centroid_lng" | "lot_sqft" | "customer_id"
>;

export type DoorBookingInput = {
  parcel: DoorParcel;
  knocker_name: string;
  outcome: Extract<KnockOutcome, "quote_given" | "booked">;
  /** Typed amounts (the details sheet); null / omitted = none typed, so `default_price` is used. */
  amount_low?: number | null;
  amount_high?: number | null;
  /** The house's quote price for this service (null when the tier is not priced); the default amount. */
  default_price?: number | null;
  service: ServiceKey;
};

export type DoorBookingResult = { customer_id: string; lead_id: string; quote_id: string; job_id: string | null };

/** Door-quote price: the mid of low / high (high never below low, both at least 0). */
export function doorPrice(amountLow: number, amountHigh: number): { low: number; high: number; price: number } {
  const low = Math.max(0, Number(amountLow) || 0);
  const high = Math.max(low, Number(amountHigh) || 0);
  return { low, high, price: moneyRound((low + high) / 2) };
}

/**
 * The amounts for a door quote: typed low / high when there are any, else the house's tier price for both, else 0
 * (`priced: false`: the owner sets the price). A single typed amount stands for both ends.
 */
export function doorAmounts(input: Pick<DoorBookingInput, "amount_low" | "amount_high" | "default_price">): {
  low: number;
  high: number;
  price: number;
  priced: boolean;
} {
  const typedLow = input.amount_low ?? input.amount_high ?? null;
  const typedHigh = input.amount_high ?? input.amount_low ?? null;
  const fallback = typeof input.default_price === "number" && Number.isFinite(input.default_price) ? input.default_price : null;
  const low = typedLow ?? fallback;
  const high = typedHigh ?? fallback;
  if (low === null || high === null) return { low: 0, high: 0, price: 0, priced: false };
  return { ...doorPrice(low, high), priced: true };
}

/** "$40" for one price, "$45–$60" for a typed range. */
export const doorAmountText = (low: number, high: number): string => (low === high ? `$${low}` : `$${low}–$${high}`);

/** The default amount for a door quote: the house's price for the service when it is priced, else null. */
export function defaultDoorPrice(
  parcel: Parameters<typeof estimateTurf>[0] & Pick<Parcel, "turf_sqft_traced" | "market_value">,
  settings: QuoteSettings & Pick<CanvassSettings, "hardscape_pct">,
  service: ServiceKey,
): number | null {
  // Same recompute as the views: the estimate follows the current hardscape_pct; a traced lawn wins.
  const quote = quoteFor(service, { ...parcel, turf_sqft_est: estimateTurf(parcel, settings.hardscape_pct) }, settings);
  return quote.status === "priced" ? quote.price : null;
}

/** Customer name when the county record has no usable owner name. */
export function doorCustomerName(parcel: Pick<DoorParcel, "owner_display" | "address">): string {
  const owner = parcel.owner_display?.trim();
  return owner ? owner : `Resident, ${parcel.address.trim()}`;
}

/** Leading house number of an address ("19000 Detroit Rd" → "19000"), or null. */
function houseNumber(address: string): string | null {
  const m = normalizeAddress(address).match(/^(\d+)/);
  return m ? m[1] : null;
}

/** parcels.customer_id → customers.parcel_id → normalised address prefix → null. */
export async function findDoorCustomer(db: Db, parcel: DoorParcel): Promise<Customer | null> {
  if (parcel.customer_id) {
    const byId = check(await db.from("customers").select("*").eq("id", parcel.customer_id).maybeSingle(), "doorCustomer(id)");
    if (byId) return byId;
  }
  const byPin = check(
    await db.from("customers").select("*").eq("parcel_id", parcel.parcel_id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "doorCustomer(parcel_id)",
  );
  if (byPin) return byPin;

  const number = houseNumber(parcel.address);
  const target = normalizeAddress(parcel.address);
  if (!number || !target) return null;
  const candidates =
    check(await db.from("customers").select("*").ilike("address", `${number}%`).order("created_at", { ascending: true }).limit(50), "doorCustomer(address)") ??
    [];
  return candidates.find((c) => normalizeAddress(c.address).startsWith(target)) ?? null;
}

/** Creates (or links) the customer, then lead + quote (+ job when booked). Sets parcels.customer_id. */
export async function createDoorLeadAndQuote(db: Db, input: DoorBookingInput): Promise<DoorBookingResult> {
  const { parcel, outcome, service } = input;
  const { low, high, price, priced } = doorAmounts(input);
  const now = new Date().toISOString();
  const label = SERVICE_LABELS[service];

  let customer = await findDoorCustomer(db, parcel);
  if (!customer) {
    customer = one(
      await db
        .from("customers")
        .insert({
          name: doorCustomerName(parcel),
          email: null,
          phone: null,
          address: parcel.address,
          lat: parcel.centroid_lat,
          lng: parcel.centroid_lng,
          parcel_id: parcel.parcel_id,
          lot_acres: parcel.lot_sqft !== null && parcel.lot_sqft > 0 ? Math.round((parcel.lot_sqft / 43_560) * 1000) / 1000 : null,
          tree_cover: null,
          email_opt_in: false,
          sms_opt_in: false,
          snow_list: false,
          notes: null,
        })
        .select("*")
        .single(),
      "doorBooking(customer)",
    );
  }

  const settings = await getSettings(db);
  const booked = outcome === "booked";
  const lead = one(
    await db
      .from("leads")
      .insert({
        customer_id: customer.id,
        source: DOOR_SOURCE,
        utm: { source: DOOR_SOURCE, medium: "door", campaign: parcel.street || undefined },
        requested_service_ids: [],
        custom_request: `Door quote: ${label}`,
        photo_paths: [],
        preferred_days: [],
        status: booked ? "won" : "quoted",
        flyer_worker_id: null,
      })
      .select("*")
      .single(),
    "doorBooking(lead)",
  );

  const labor = moneyRound(settings.default_wage * DOOR_EST_HOURS);
  const expires = new Date(Date.now() + Math.max(1, settings.quote_valid_days) * 86_400_000).toISOString();
  const quote = one(
    await db
      .from("quotes")
      .insert({
        lead_id: lead.id,
        customer_id: customer.id,
        status: booked ? "accepted" : "sent",
        price_total: price,
        labor_total: labor,
        fee_total: 0,
        profit_total: moneyRound(price - labor),
        margin: settings.margin,
        wage: settings.default_wage,
        payment_method: null,
        sent_at: now,
        accepted_at: booked ? now : null,
        paid_at: null,
        expires_at: booked ? null : expires,
        rationale: priced
          ? `Door quote by ${input.knocker_name}: ${doorAmountText(low, high)} for ${label}.`
          : `Door quote by ${input.knocker_name} for ${label}: price to be set.`,
      })
      .select("*")
      .single(),
    "doorBooking(quote)",
  );
  check(
    await db.from("quote_items").insert({
      quote_id: quote.id,
      service_id: null,
      description: `Door quote: ${label}`,
      is_custom: true,
      crew_size: 1,
      est_hours: DOOR_EST_HOURS,
      price,
      status: "priced",
      partner_note: null,
      ai_summary: null,
      sort_order: 0,
    }),
    "doorBooking(item)",
  );

  let job_id: string | null = null;
  if (booked) {
    const job = await ensureJobForQuote(db, quote.id);
    if (job) {
      job_id = job.id;
    } else {
      job_id = one(
        await db
          .from("jobs")
          .insert({
            quote_id: quote.id,
            customer_id: customer.id,
            status: "unscheduled",
            start_at: null,
            end_at: null,
            est_minutes: DOOR_EST_HOURS * 60,
            crew_size: 1,
            paid: false,
            paid_at: null,
            weather_hold: false,
            deadline: null,
            completion_photo_paths: [],
          })
          .select("*")
          .single(),
        "doorBooking(job)",
      ).id;
    }
  }

  if (parcel.customer_id !== customer.id) {
    check(await db.from("parcels").update({ customer_id: customer.id }).eq("id", parcel.id), "doorBooking(parcel link)");
  }
  return { customer_id: customer.id, lead_id: lead.id, quote_id: quote.id, job_id };
}

/** Quote statuses a door quote can still be re-priced in (not paid). */
const REPRICEABLE = ["sent", "accepted"] as const;

/**
 * The crew typed the real amounts in the details sheet after the knock (and its quote) were saved: re-price the
 * door quote the same way `createDoorLeadAndQuote` would have (total, profit, its one custom line, rationale).
 * False when the quote is gone, paid or no longer sent / accepted.
 */
export async function repriceDoorQuote(db: Db, quoteId: string, amountLow: number, amountHigh: number): Promise<boolean> {
  const { low, high, price } = doorPrice(amountLow, amountHigh);
  const quote = check(
    await db.from("quotes").select("id,status,labor_total,paid_at,rationale").eq("id", quoteId).maybeSingle(),
    "repriceDoorQuote(quote)",
  );
  if (!quote || quote.paid_at || !(REPRICEABLE as readonly string[]).includes(quote.status)) return false;
  const rationale = (quote.rationale ?? "").replace(/\$[\d.,]+(?:–\$[\d.,]+)?|price to be set/, () => doorAmountText(low, high));
  check(
    await db
      .from("quotes")
      .update({ price_total: price, profit_total: moneyRound(price - (Number(quote.labor_total) || 0)), rationale })
      .eq("id", quote.id),
    "repriceDoorQuote(update)",
  );
  check(await db.from("quote_items").update({ price }).eq("quote_id", quote.id).eq("is_custom", true), "repriceDoorQuote(item)");
  return true;
}
