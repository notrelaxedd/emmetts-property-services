/**
 * Stripe Checkout for quotes + refunds. TEST MODE ONLY (see ./client.ts): going live is the owner's
 * explicit call.
 *
 * Plain Node (relative imports, no `server-only`) so server actions, route handlers and fleet
 * workers can all use it.
 */
import { createHash } from "node:crypto";
import type { Quote, QuoteItem } from "../db/types";
import { canTransition, transitionJob } from "../ops/jobs";
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import { getStripe } from "./client";
import { taxConfig } from "./tax";
import type { TaxConfig } from "./tax";

export const ADJUSTMENT_LINE_NAME = "Minimum job adjustment";

export type CheckoutLine = { name: string; unitAmount: number };

/** One billed line, shared by Checkout and invoices. Amounts in cents. */
export type BilledLine = { description: string; unit_amount_cents: number; quantity: number };

type BillableItem = Pick<QuoteItem, "description" | "price" | "status" | "sort_order">;

/**
 * The lines a customer is charged for a quote (amounts in cents), used by both Checkout and invoices.
 * - Only `auto` / `priced` items with a positive price are billed; declined / referred / unpriced are skipped.
 * - If `price_total` is above the sum of item prices (minimum-job-price floor) the difference becomes a
 *   "Minimum job adjustment" line.
 * - If `price_total` is below the sum (owner overrode the total downwards) the item amounts are scaled
 *   down proportionally so the customer is charged exactly `price_total`.
 * `price_total` is pre-tax: with Stripe Tax on, tax is added on top (see ./tax.ts).
 */
export function billedLines(quote: Pick<Quote, "price_total">, items: BillableItem[]): BilledLine[] {
  const billed = items
    .filter((i) => (i.status === "auto" || i.status === "priced") && i.price !== null && i.price !== undefined && i.price > 0)
    .sort((a, b) => a.sort_order - b.sort_order);
  if (billed.length === 0) throw new Error("billedLines: quote has no priced items");

  const lines: BilledLine[] = billed.map((i) => ({
    description: i.description.trim().slice(0, 250) || "Service",
    unit_amount_cents: Math.round((i.price as number) * 100),
    quantity: 1,
  }));
  const sum = lines.reduce((s, l) => s + l.unit_amount_cents * l.quantity, 0);
  const total = Math.round(quote.price_total * 100);
  if (!Number.isFinite(total) || total <= 0) throw new Error("billedLines: quote price_total must be positive");

  if (total > sum) {
    lines.push({ description: ADJUSTMENT_LINE_NAME, unit_amount_cents: total - sum, quantity: 1 });
  } else if (total < sum) {
    const scaled = lines.map((l) => ({ ...l, unit_amount_cents: Math.max(1, Math.floor((l.unit_amount_cents * total) / sum)) }));
    const diff = total - scaled.reduce((s, l) => s + l.unit_amount_cents, 0);
    const biggest = scaled.reduce((bi, l, i) => (l.unit_amount_cents > scaled[bi].unit_amount_cents ? i : bi), 0);
    scaled[biggest].unit_amount_cents += diff;
    if (scaled.some((l) => l.unit_amount_cents <= 0)) throw new Error("billedLines: price_total too low for the quoted items");
    return scaled;
  }
  return lines;
}

/** `billedLines` in the Checkout shape (kept for callers / tests that predate invoices). */
export function buildCheckoutLines(items: BillableItem[], priceTotal: number): CheckoutLine[] {
  return billedLines({ price_total: priceTotal }, items).map((l) => ({ name: l.description, unitAmount: l.unit_amount_cents }));
}

function hashFor(lines: CheckoutLine[], email: string, siteUrl: string, tax: TaxConfig): string {
  // Tax settings are part of the hash so flipping STRIPE_TAX_ENABLED / STRIPE_TAX_CODE mints a new session.
  const taxPart = tax.enabled || tax.taxCode ? { tax: tax.enabled, code: tax.taxCode ?? null } : {};
  return createHash("sha256")
    .update(JSON.stringify({ lines, email: email.toLowerCase(), siteUrl, ...taxPart }))
    .digest("hex")
    .slice(0, 16);
}

const HOUR_MS = 3_600_000;

/**
 * Stripe allows sessions to live at most 24h. We use the top of the hour at most 23h out so the value
 * is stable across quick retries (same idempotency key => same params) and never trips the 24h cap.
 */
export function checkoutExpiresAt(now: Date = new Date()): number {
  return Math.floor((now.getTime() + 23 * HOUR_MS) / HOUR_MS) * (HOUR_MS / 1000);
}

/**
 * Creates (or reuses) the Checkout Session for a quote and stores `stripe_checkout_id` /
 * `stripe_checkout_url` on it. Re-calling with unchanged items returns the still-open session;
 * if items/price changed the previous open session is expired so only one link can be paid.
 */
export async function createCheckoutForQuote(
  db: Db,
  quoteId: string,
  opts: { siteUrl: string },
): Promise<{ id: string; url: string }> {
  const siteUrl = opts.siteUrl.replace(/\/$/, "");
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "createCheckout(quote)");
  if (!quote) throw new Error(`createCheckoutForQuote: quote ${quoteId} not found`);
  const customer = check(
    await db.from("customers").select("*").eq("id", quote.customer_id).maybeSingle(),
    "createCheckout(customer)",
  );
  if (!customer) throw new Error(`createCheckoutForQuote: customer ${quote.customer_id} not found`);
  if (!customer.email) throw new Error(`createCheckoutForQuote: customer ${customer.id} has no email address`);
  if (quote.stripe_invoice_url) {
    // One way to pay at a time: the owner switched to Checkout without voiding the invoice (the quote
    // handler voids it first; the /quote/pay link redirects to the invoice instead of calling this).
    throw new Error(`createCheckoutForQuote: quote ${quoteId} has an open Stripe invoice; void it before sending a Checkout link`);
  }
  const items = check(
    await db.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true }),
    "createCheckout(items)",
  );

  const lines = buildCheckoutLines(items ?? [], quote.price_total);
  const tax = taxConfig();
  const hash = hashFor(lines, customer.email, siteUrl, tax);
  const stripe = getStripe();

  if (quote.stripe_checkout_id) {
    try {
      const prev = await stripe.checkout.sessions.retrieve(quote.stripe_checkout_id);
      if (prev.status === "open") {
        if (prev.metadata?.items_hash === hash && prev.url) return { id: prev.id, url: prev.url };
        await stripe.checkout.sessions.expire(prev.id).catch(() => undefined);
      }
    } catch (e) {
      console.warn(`[stripe] could not inspect previous checkout session ${quote.stripe_checkout_id}:`, e);
    }
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: customer.email,
      client_reference_id: quoteId,
      line_items: lines.map((l) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: l.unitAmount,
          // price_total is pre-tax: any sales tax is added on top.
          tax_behavior: "exclusive",
          product_data: { name: l.name, ...(tax.taxCode ? { tax_code: tax.taxCode } : {}) },
        },
      })),
      // Stripe Tax (Ohio sales tax on lawn care) needs the buyer's address to compute tax.
      ...(tax.enabled ? { automatic_tax: { enabled: true }, billing_address_collection: "required" as const } : {}),
      metadata: { quote_id: quoteId, customer_id: quote.customer_id, items_hash: hash },
      payment_intent_data: { metadata: { quote_id: quoteId, customer_id: quote.customer_id } },
      success_url: `${siteUrl}/quote/paid?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/quote/thanks?cancelled=1`,
      expires_at: checkoutExpiresAt(),
    },
    { idempotencyKey: `quote-${quoteId}-${hash}` },
  );
  if (!session.url) throw new Error("createCheckoutForQuote: Stripe returned a session without a URL");

  check(
    await db.from("quotes").update({ stripe_checkout_id: session.id, stripe_checkout_url: session.url }).eq("id", quoteId),
    "createCheckout(save)",
  );
  return { id: session.id, url: session.url };
}

/**
 * Kills the quote's current Checkout link before the quote is revised, so the customer can't pay the
 * old amount. Expires the stored session if it is still open and clears `stripe_checkout_url`.
 * THROWS (and leaves the quote alone) if that session has already been paid: the payment is on its
 * way through the webhook, so the owner must refund instead of revising.
 */
export async function expireOpenCheckout(db: Db, quoteId: string): Promise<{ expired: boolean }> {
  const quote = check(
    await db.from("quotes").select("id,stripe_checkout_id").eq("id", quoteId).maybeSingle(),
    "expireOpenCheckout(quote)",
  );
  if (!quote) throw new Error(`expireOpenCheckout: quote ${quoteId} not found`);
  let expired = false;
  if (quote.stripe_checkout_id) {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(quote.stripe_checkout_id);
    if (session.status === "complete") {
      throw new Error("The customer has already paid this quote's checkout link; refund it instead of revising.");
    }
    if (session.status === "open") {
      try {
        await stripe.checkout.sessions.expire(session.id);
        expired = true;
      } catch (e) {
        // Lost a race with the customer paying (or Stripe expired it first): look again.
        const again = await stripe.checkout.sessions.retrieve(session.id);
        if (again.status === "complete") {
          throw new Error("The customer paid this quote while it was being revised; refund it instead.");
        }
        if (again.status !== "expired") throw e;
      }
    }
  }
  check(await db.from("quotes").update({ stripe_checkout_url: null }).eq("id", quoteId), "expireOpenCheckout(clear url)");
  return { expired };
}

/**
 * Owner-initiated full refund for a paid quote: refunds the stored payment intent, cancels the job
 * and marks the quote `declined`. Refuses (before touching Stripe) if the job is already done.
 * Same path for Checkout and invoice payments: the webhook stores the PaymentIntent of either in
 * `stripe_payment_intent_id`. A full refund returns everything charged, sales tax included. An invoice
 * paid outside Stripe (marked paid by hand) has no PaymentIntent and can't be refunded here.
 */
export async function refundQuote(
  db: Db,
  quoteId: string,
  opts: { reason: string },
): Promise<{ refundId: string; jobCancelled: boolean }> {
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "refundQuote(quote)");
  if (!quote) throw new Error(`refundQuote: quote ${quoteId} not found`);
  if (!quote.stripe_payment_intent_id) throw new Error(`refundQuote: quote ${quoteId} has no payment to refund`);

  const job = check(
    await db.from("jobs").select("*").eq("quote_id", quoteId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    "refundQuote(job)",
  );
  const needsCancel = !!job && job.status !== "cancelled";
  if (job && needsCancel && !canTransition(job.status, "cancelled")) {
    throw new Error(`refundQuote: job ${job.id} is ${job.status} and cannot be cancelled`);
  }

  const refund = await getStripe().refunds.create(
    {
      payment_intent: quote.stripe_payment_intent_id,
      reason: "requested_by_customer",
      metadata: { quote_id: quoteId, note: opts.reason.slice(0, 450) },
    },
    { idempotencyKey: `refund-quote-${quoteId}` },
  );

  if (job && needsCancel) await transitionJob(db, job.id, "cancelled", { actor: "refund" });

  const chargeId = typeof refund.charge === "string" ? refund.charge : (refund.charge?.id ?? "");
  const note = `Refunded in Stripe (${refund.id}${chargeId ? `, charge ${chargeId}` : ""}): ${opts.reason}`;
  one(
    await db
      .from("quotes")
      .update({ status: "declined", rationale: appendNote(quote.rationale, note) })
      .eq("id", quoteId)
      .select("*")
      .single(),
    "refundQuote(update)",
  );
  return { refundId: refund.id, jobCancelled: needsCancel };
}

/** Appends a dated line to a quote's `rationale`. */
export function appendNote(existing: Quote["rationale"], note: string, now: Date = new Date()): string {
  const line = `[${now.toISOString().slice(0, 10)}] ${note}`;
  return existing ? `${existing}\n${line}` : line;
}
