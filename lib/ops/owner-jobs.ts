/**
 * Jobs the owner schedules by hand from a customer's page: no quote form, no AI estimate. You say what
 * the job is, the price and how long it takes; this writes the chain a normal booking leaves behind
 * (lead `won` → quote `accepted` → one priced line → job `unscheduled`), ready to be put on the calendar
 * and booked (app/admin/actions/schedule.ts `scheduleForCustomer`). The lead's `source` is `owner`.
 *
 * Plain Node (relative imports) like the rest of lib/ops.
 */
import type { Job, PaymentMethod } from "../db/types";
import { fee, moneyRound } from "../pricing";
import { ensureJobForQuote } from "./jobs";
import { getSettings } from "./settings";
import { check, one } from "./types";
import type { Db } from "./types";

export const OWNER_SOURCE = "owner";

export type OwnerJob = {
  customerId: string;
  /** What the job is, e.g. "Fall cleanup". Becomes the quote line. */
  description: string;
  /** Agreed price. */
  price: number;
  /** Hours on site (sets the calendar slot). */
  hours: number;
  /** How many crew the job needs (at least 1). */
  crewSize: number;
  /** How they'll pay once it's done. */
  paymentMethod: PaymentMethod;
  /** Who scheduled it (owner email), for the note. */
  recordedBy: string;
};

/** Creates the lead, accepted quote, line and unscheduled job. THROWS (writing nothing) on bad input. */
export async function createOwnerJob(db: Db, j: OwnerJob): Promise<{ quoteId: string; job: Job }> {
  const description = j.description.trim();
  if (!description) throw new Error("Say what the job is.");
  if (!(j.price >= 0)) throw new Error("The price can't be negative.");
  if (!(j.hours > 0)) throw new Error("Set how long the job takes.");
  const crewSize = Math.max(1, Math.round(j.crewSize));
  const customer = check(await db.from("customers").select("id").eq("id", j.customerId).maybeSingle(), "ownerJob(customer)");
  if (!customer) throw new Error("Customer not found.");

  const settings = await getSettings(db);
  const now = new Date().toISOString();
  const price = moneyRound(j.price);
  const labor = moneyRound(settings.default_wage * j.hours * crewSize);
  const feeTotal = j.paymentMethod === "stripe" ? fee(price, settings) : 0;

  const lead = one(
    await db
      .from("leads")
      .insert({
        customer_id: j.customerId,
        source: OWNER_SOURCE,
        status: "won",
        custom_request: description,
        requested_service_ids: [],
        photo_paths: [],
        preferred_days: [],
        utm: {},
      })
      .select("*")
      .single(),
    "ownerJob(lead)",
  );
  try {
    const quote = one(
      await db
        .from("quotes")
        .insert({
          lead_id: lead.id,
          customer_id: j.customerId,
          status: "accepted",
          price_total: price,
          labor_total: labor,
          fee_total: feeTotal,
          profit_total: moneyRound(price - labor - feeTotal),
          margin: settings.margin,
          wage: settings.default_wage,
          payment_method: j.paymentMethod,
          accepted_at: now,
          paid_at: null,
          rationale: `Scheduled by hand by ${j.recordedBy}.`,
        })
        .select("*")
        .single(),
      "ownerJob(quote)",
    );
    check(
      await db.from("quote_items").insert({
        quote_id: quote.id,
        service_id: null,
        description,
        is_custom: true,
        crew_size: crewSize,
        est_hours: j.hours,
        price,
        status: "priced",
        partner_note: null,
        ai_summary: null,
        sort_order: 0,
      }),
      "ownerJob(item)",
    );
    const job = await ensureJobForQuote(db, quote.id);
    if (!job) throw new Error("Couldn't create the job.");
    return { quoteId: quote.id, job };
  } catch (e) {
    // No transactions through PostgREST: undo by hand. The lead takes its quote, line and job with it.
    await db.from("leads").delete().eq("id", lead.id);
    throw e;
  }
}
