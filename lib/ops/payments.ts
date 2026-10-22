/**
 * Cash and check payments, recorded by the owner on the quote page. The same accept path as a Stripe
 * payment (lib/stripe/webhook.ts): quote `accepted`, lead `won`, job created + `schedule` task. Before
 * accepting, the quote's open Checkout session is expired and its open Stripe invoice voided (refused if
 * the customer already paid one of them), so the customer can't pay twice.
 *
 * Plain Node (relative imports) like the rest of lib/ops.
 */
import type { PaymentMethod, QuoteStatus } from "../db/types";
import { moneyRound } from "../pricing";
import { appendNote, expireOpenCheckout } from "../stripe/checkout";
import { voidInvoiceForQuote } from "../stripe/invoice";
import { createJobFromQuote } from "./jobs";
import { check } from "./types";
import type { Db } from "./types";

export const OFFLINE_METHODS = ["cash", "check"] as const satisfies readonly PaymentMethod[];
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

/** Statuses a cash / check payment can be recorded for. `expired`: the customer paid late, the money is here. */
const PAYABLE: QuoteStatus[] = ["draft", "needs_owner", "sent", "expired"];

const money = (n: number) => `$${n.toFixed(2)}`;

export type OfflinePayment = {
  method: OfflineMethod;
  /** Dollars received (pre-tax, like `price_total`). */
  amount: number;
  /** Check number, for the note. Ignored for cash. */
  checkNumber?: string | null;
  /** Who recorded it (owner email), for the note. */
  recordedBy: string;
};

/** The dated line added to the quote's notes, e.g. "Paid by check #1042: $80.00, recorded by …". */
export function offlinePaymentNote(p: OfflinePayment, priceTotal: number): string[] {
  const what = p.method === "check" ? `check${p.checkNumber?.trim() ? ` #${p.checkNumber.trim()}` : ""}` : "cash";
  const notes = [`Paid by ${what}: ${money(p.amount)}, recorded by ${p.recordedBy}.`];
  const diff = moneyRound(p.amount - priceTotal);
  if (diff !== 0) {
    notes.push(
      `WARNING: Paid amount differs from quote — received ${money(p.amount)} by ${p.method} but the quote total is ${money(priceTotal)}. ${diff < 0 ? "Collect" : "Return"} the difference.`,
    );
  }
  return notes;
}

/**
 * Accepts a quote paid by cash or check. THROWS (leaving the quote alone) when the quote is already paid
 * or declined, or when the customer already paid its Checkout link / invoice (refund that instead).
 */
export async function recordOfflinePayment(db: Db, quoteId: string, p: OfflinePayment): Promise<{ jobId: string }> {
  if (!(p.amount > 0)) throw new Error("The amount received must be more than $0.");
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "offlinePayment(quote)");
  if (!quote) throw new Error(`recordOfflinePayment: quote ${quoteId} not found`);
  if (quote.status === "accepted") throw new Error("This quote is already paid.");
  if (!PAYABLE.includes(quote.status)) throw new Error(`This quote is ${quote.status}.`);

  // One way to pay at a time: close the online options first. Both throw if the customer already paid.
  if (quote.stripe_checkout_id) await expireOpenCheckout(db, quoteId);
  if (quote.stripe_invoice_id) await voidInvoiceForQuote(db, quoteId);

  let rationale = quote.rationale;
  for (const note of offlinePaymentNote(p, quote.price_total)) rationale = appendNote(rationale, note);

  const { data: accepted, error } = await db
    .from("quotes")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      payment_method: p.method,
      // No card fee on cash / check.
      fee_total: 0,
      profit_total: moneyRound(quote.price_total - quote.labor_total),
      stripe_checkout_url: null,
      stripe_invoice_url: null,
      rationale,
    })
    .eq("id", quoteId)
    .eq("status", quote.status) // a Stripe payment landing in between wins
    .select("id");
  if (error) throw new Error(error.message);
  if (!accepted?.length) throw new Error("The quote changed while recording the payment (was it just paid online?). Reload the page.");

  check(await db.from("leads").update({ status: "won" }).eq("id", quote.lead_id), "offlinePayment(lead won)");
  const job = await createJobFromQuote(db, quoteId); // idempotent; enqueues the `schedule` task
  return { jobId: job.id };
}
