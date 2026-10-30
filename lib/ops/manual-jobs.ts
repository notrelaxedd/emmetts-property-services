/**
 * Jobs the owner records by hand once they're already done and paid (a job taken on the phone or on the
 * street, or one from before the site): pick the customer, say what was done, the price and what they
 * paid, and it shows on the Money page like any other paid job. One call writes the same chain a normal
 * job leaves behind (lead `won` → quote `accepted` + paid → one priced line → job `done` + paid), all
 * dated on the day of the job. No tasks, emails or Stripe calls. The lead's `source` is `manual`, which is
 * what lets an entry made by mistake be removed again.
 *
 * Revenue is what they paid, tip included: the quote's `price_total` is the amount received, and the line
 * keeps the price (the same "total override" shape the quote editor uses when the two differ).
 *
 * Plain Node (relative imports) like the rest of lib/ops.
 */
import type { PaymentMethod } from "../db/types";
import { fee, moneyRound } from "../pricing";
import { zonedToUtc } from "../scheduler/time";
import { deleteQuote } from "./delete-quote";
import { getSettings } from "./settings";
import { check, one } from "./types";
import type { Db } from "./types";

export const MANUAL_SOURCE = "manual";

const money = (n: number) => `$${n.toFixed(2)}`;
const METHOD_WORD: Record<PaymentMethod, string> = { cash: "cash", check: "check", stripe: "card" };

export type ManualJob = {
  customerId: string;
  /** What was done, e.g. "Fall cleanup". Becomes the quote line. */
  description: string;
  /** Local "YYYY-MM-DD" the job was done and paid. */
  date: string;
  /** What the job was priced at. */
  price: number;
  /** What the customer actually paid: the revenue. */
  paid: number;
  method: PaymentMethod;
  /** What the crew was paid for it, if known (shown as estimated labor until payouts are logged). */
  labor: number;
  /** Who recorded it (owner email), for the note. */
  recordedBy: string;
};

/** The note on the quote, e.g. "Recorded by hand: done and paid by cash ($80.00), by owner@…". Paying over the price is a tip. */
export function manualJobNote(j: Pick<ManualJob, "price" | "paid" | "method" | "recordedBy">): string {
  const paid = `paid by ${METHOD_WORD[j.method]} (${money(j.paid)})`;
  const diff = moneyRound(j.paid - j.price);
  const vs = diff === 0 ? "" : `; priced at ${money(j.price)}, ${diff > 0 ? `${money(diff)} tip` : `${money(-diff)} less`}`;
  return `Recorded by hand: done and ${paid}${vs}, by ${j.recordedBy}.`;
}

/** Records a finished, paid job. THROWS (writing nothing) when the input is bad or the customer is gone. */
export async function recordManualJob(db: Db, j: ManualJob): Promise<{ quoteId: string; jobId: string }> {
  if (!(j.paid > 0)) throw new Error("What they paid must be more than $0.");
  if (!(j.price > 0)) throw new Error("The price must be more than $0.");
  if (j.labor < 0) throw new Error("Crew pay can't be negative.");
  const description = j.description.trim();
  if (!description) throw new Error("Say what the job was.");
  const customer = check(await db.from("customers").select("id").eq("id", j.customerId).maybeSingle(), "manualJob(customer)");
  if (!customer) throw new Error("Customer not found.");

  // Midday local time, so the job lands on the right day (and month) whatever the timezone.
  const when = zonedToUtc(j.date, "12:00").toISOString();
  const paid = moneyRound(j.paid);
  const price = moneyRound(j.price);
  const labor = moneyRound(j.labor);
  const fee_total = j.method === "stripe" ? fee(paid, await getSettings(db)) : 0;

  const lead = one(
    await db
      .from("leads")
      .insert({
        created_at: when,
        customer_id: j.customerId,
        source: MANUAL_SOURCE,
        status: "won",
        custom_request: description,
        requested_service_ids: [],
        photo_paths: [],
        preferred_days: [],
        utm: {},
      })
      .select("*")
      .single(),
    "manualJob(lead)",
  );
  try {
    const quote = one(
      await db
        .from("quotes")
        .insert({
          created_at: when,
          lead_id: lead.id,
          customer_id: j.customerId,
          status: "accepted",
          price_total: paid,
          labor_total: labor,
          fee_total,
          profit_total: moneyRound(paid - labor - fee_total),
          payment_method: j.method,
          accepted_at: when,
          paid_at: when,
          rationale: manualJobNote({ ...j, price, paid }),
        })
        .select("*")
        .single(),
      "manualJob(quote)",
    );
    check(
      await db.from("quote_items").insert({
        quote_id: quote.id,
        service_id: null,
        description,
        is_custom: true,
        crew_size: 1,
        est_hours: 0,
        price,
        status: "priced",
        partner_note: null,
        ai_summary: null,
        sort_order: 0,
      }),
      "manualJob(item)",
    );
    const job = one(
      await db
        .from("jobs")
        .insert({
          created_at: when,
          quote_id: quote.id,
          customer_id: j.customerId,
          status: "done",
          start_at: null,
          end_at: null,
          est_minutes: 0,
          crew_size: 1,
          paid: true,
          paid_at: when,
          completed_at: when,
          weather_hold: false,
          deadline: null,
          completion_photo_paths: [],
        })
        .select("*")
        .single(),
      "manualJob(job)",
    );
    return { quoteId: quote.id, jobId: job.id };
  } catch (e) {
    // No transactions through PostgREST: undo by hand. The lead takes its quote and line with it.
    await db.from("leads").delete().eq("id", lead.id);
    throw e;
  }
}

/**
 * Removes a job recorded by hand (entered by mistake): its job, quote, line and lead. Refuses anything
 * that came in through the site, and a job with crew payouts on record (delete those first).
 */
export async function removeManualJob(db: Db, quoteId: string): Promise<{ customerId: string }> {
  const quote = check(await db.from("quotes").select("id,lead_id").eq("id", quoteId).maybeSingle(), "removeManualJob(quote)");
  if (!quote) throw new Error("Job not found.");
  const lead = check(await db.from("leads").select("id,source").eq("id", quote.lead_id).maybeSingle(), "removeManualJob(lead)");
  if (lead?.source !== MANUAL_SOURCE) throw new Error("Only jobs added by hand can be removed here.");
  return deleteQuote(db, quoteId);
}
