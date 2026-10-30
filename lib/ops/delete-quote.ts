/**
 * Deleting a quote or job the owner doesn't want on the books (entered twice, a test, a customer who
 * backed out): the quote, its lines, its job(s) and their crew offers, any approvals about them, and its
 * lead when no other quote hangs off it. Revenue and labor come off the Money page with it.
 *
 * Refuses a job with crew payouts on record (delete those on the employee's page first). An unpaid quote's
 * open Stripe link / invoice is closed first so the customer can't pay something that's gone; a card
 * payment that already went through is NOT refunded (use Refund on the quote for that).
 *
 * Plain Node (relative imports) like the rest of lib/ops.
 */
import { expireOpenCheckout } from "../stripe/checkout";
import { voidInvoiceForQuote } from "../stripe/invoice";
import { check } from "./types";
import type { Db } from "./types";

const PAYOUTS_MESSAGE = "This job has crew payouts on record; delete those on the employee's page first.";

async function refuseIfPayouts(db: Db, jobIds: string[]): Promise<void> {
  if (!jobIds.length) return;
  const payouts = check(await db.from("payouts").select("id").in("job_id", jobIds).limit(1), "delete(payouts)") ?? [];
  if (payouts.length) throw new Error(PAYOUTS_MESSAGE);
}

async function deleteJobs(db: Db, jobIds: string[], what: string): Promise<void> {
  if (!jobIds.length) return;
  check(await db.from("approvals").delete().eq("ref_table", "jobs").in("ref_id", jobIds), `${what}(job approvals)`);
  const res = await db.from("jobs").delete().in("id", jobIds);
  // A payout logged in between still wins.
  if (res.error && (res.error as { code?: string }).code === "23503") throw new Error(PAYOUTS_MESSAGE);
  check(res, `${what}(jobs)`);
}

/** Deletes a quote and everything hanging off it. THROWS (deleting nothing) when a job has crew payouts. */
export async function deleteQuote(db: Db, quoteId: string): Promise<{ customerId: string }> {
  const quote = check(
    await db.from("quotes").select("id,lead_id,customer_id,paid_at,stripe_checkout_id,stripe_invoice_id").eq("id", quoteId).maybeSingle(),
    "deleteQuote(quote)",
  );
  if (!quote) throw new Error("Quote not found.");
  const jobIds = (check(await db.from("jobs").select("id").eq("quote_id", quoteId), "deleteQuote(jobs)") ?? []).map((j) => j.id);
  await refuseIfPayouts(db, jobIds);

  if (!quote.paid_at) {
    if (quote.stripe_checkout_id) await expireOpenCheckout(db, quoteId);
    if (quote.stripe_invoice_id) await voidInvoiceForQuote(db, quoteId);
  }

  const itemIds = (check(await db.from("quote_items").select("id").eq("quote_id", quoteId), "deleteQuote(items)") ?? []).map((i) => i.id);
  await deleteJobs(db, jobIds, "deleteQuote");
  check(await db.from("approvals").delete().eq("ref_table", "quotes").eq("ref_id", quoteId), "deleteQuote(approvals)");
  if (itemIds.length) {
    check(await db.from("approvals").delete().eq("ref_table", "quote_items").in("ref_id", itemIds), "deleteQuote(item approvals)");
  }
  // Lines go with the quote (on delete cascade).
  check(await db.from("quote_items").delete().eq("quote_id", quoteId), "deleteQuote(lines)");
  check(await db.from("quotes").delete().eq("id", quoteId), "deleteQuote(quote)");

  const others = check(await db.from("quotes").select("id").eq("lead_id", quote.lead_id).limit(1), "deleteQuote(other quotes)") ?? [];
  if (!others.length) check(await db.from("leads").delete().eq("id", quote.lead_id), "deleteQuote(lead)");
  return { customerId: quote.customer_id };
}

/**
 * Deletes a job from the Money page. A job with a quote takes the quote with it (that's where the
 * revenue comes from); a job without one is deleted on its own.
 */
export async function deleteJob(db: Db, jobId: string): Promise<{ customerId: string }> {
  const job = check(await db.from("jobs").select("id,quote_id,customer_id").eq("id", jobId).maybeSingle(), "deleteJob(job)");
  if (!job) throw new Error("Job not found.");
  if (job.quote_id) return deleteQuote(db, job.quote_id);
  await refuseIfPayouts(db, [job.id]);
  await deleteJobs(db, [job.id], "deleteJob");
  return { customerId: job.customer_id };
}
