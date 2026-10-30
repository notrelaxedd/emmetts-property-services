/**
 * "Quote given" / "Booked" at the door: the customer, lead, quote (+ one custom line) and, for a
 * booking, an unscheduled job. Plain Node (relative imports), service-role `Db`.
 *
 *   customer: parcels.customer_id → customers.parcel_id (county PIN) → normalised address → new row
 *   lead:     source "canvass", utm { source: canvass, medium: door, campaign: <street> }, quoted | won
 *   quote:    sent (+sent_at) for a quote, accepted (+accepted_at) for a booking; price = mid of low/high
 *   item:     is_custom "Door quote: <service>", priced, 1 h
 *   job:      booked only; `ensureJobForQuote` (unscheduled, unpaid) so it lands on the "Needs a day" rail
 */
import type { Customer, KnockOutcome, Parcel } from "../db/types";
import { moneyRound } from "../pricing";
import { ensureJobForQuote } from "../ops/jobs";
import { getSettings } from "../ops/settings";
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import { normalizeAddress } from "./county";
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
  amount_low: number;
  amount_high: number;
  service: ServiceKey;
};

export type DoorBookingResult = { customer_id: string; lead_id: string; quote_id: string; job_id: string | null };

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
  const low = Math.max(0, Number(input.amount_low) || 0);
  const high = Math.max(low, Number(input.amount_high) || 0);
  const price = moneyRound((low + high) / 2);
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
        rationale: `Door quote by ${input.knocker_name}: $${low}–$${high} for ${label}.`,
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
