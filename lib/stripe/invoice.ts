/**
 * Stripe Invoicing for quotes: an alternative to the Checkout pay link for repeat / recurring customers
 * and anyone on net terms. Stripe emails the invoice and hosts the pay page; the webhook's `invoice.paid`
 * runs the same accept path as a paid Checkout session. TEST MODE ONLY (see ./client.ts).
 *
 * One way to pay at a time: sending an invoice expires the quote's open Checkout session, and sending a
 * Checkout link voids the open invoice (lib/ops/handlers/quote.ts). `stripe_invoice_url` is set only while
 * the invoice is the live way to pay.
 *
 * Plain Node (relative imports, no `server-only`) so server actions, route handlers and fleet workers can use it.
 */
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type { Customer, Quote } from "../db/types";
import { check } from "../ops/types";
import type { Db } from "../ops/types";
import { billedLines, expireOpenCheckout } from "./checkout";
import type { BilledLine } from "./checkout";
import { siteConfig } from "../site-config";
import { getStripe } from "./client";
import { parseUsAddress, taxConfig } from "./tax";
import type { TaxConfig } from "./tax";

export type InvoiceResult = { id: string; hosted_invoice_url: string };

export const MAX_DAYS_UNTIL_DUE = 365;

function invoiceHash(lines: BilledLine[], email: string, daysUntilDue: number, tax: TaxConfig): string {
  return createHash("sha256")
    .update(JSON.stringify({ lines, email: email.toLowerCase(), daysUntilDue, tax: tax.enabled, code: tax.taxCode ?? null }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * The Stripe Customer for one of our customers: the stored `stripe_customer_id`, else the first Stripe
 * customer with the same email, else a new one (name / email / phone / address). The id is saved on
 * `customers.stripe_customer_id`.
 */
export async function ensureStripeCustomer(db: Db, customer: Customer): Promise<string> {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  if (!customer.email) throw new Error(`ensureStripeCustomer: customer ${customer.id} has no email address`);
  const stripe = getStripe();
  const address = parseUsAddress(customer.address);

  const found = await stripe.customers.list({ email: customer.email, limit: 1 });
  let id: string;
  const existing = found.data[0];
  if (existing) {
    id = existing.id;
    // Stripe Tax computes tax from the customer's address; fill it in if Stripe has none.
    if (!existing.address && address) await stripe.customers.update(id, { address });
  } else {
    const created = await stripe.customers.create(
      {
        name: customer.name,
        email: customer.email,
        ...(customer.phone ? { phone: customer.phone } : {}),
        ...(address ? { address } : {}),
        metadata: { customer_id: customer.id },
      },
      { idempotencyKey: `customer-${customer.id}` },
    );
    id = created.id;
  }
  check(await db.from("customers").update({ stripe_customer_id: id }).eq("id", customer.id), "ensureStripeCustomer(save)");
  return id;
}

/**
 * Creates (or returns) the Stripe invoice for a quote and stores `stripe_invoice_id` /
 * `stripe_invoice_url` on it, marking the quote `sent`.
 *
 * - Idempotent: if the quote's invoice is still open for the same lines / terms it is returned as is
 *   (with `sendInvoice` Stripe re-emails it, which is what a "re-send" wants). An open invoice for
 *   different lines is voided first, a leftover draft (crash before finalizing) is deleted.
 * - Draft invoice → one invoice item per billed line (`billedLines`) → finalize → optionally `sendInvoice`
 *   so Stripe emails it.
 * - Expires the quote's open Checkout session first (throws if the customer already paid it).
 * - `quotes.expires_at` is cleared: an invoice has its own due date and stays payable after it, so the
 *   host worker must not expire the quote.
 */
export async function createInvoiceForQuote(
  db: Db,
  quoteId: string,
  opts: { siteUrl: string; daysUntilDue: number; sendInvoice?: boolean },
): Promise<InvoiceResult> {
  const days = Math.round(opts.daysUntilDue);
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS_UNTIL_DUE) {
    throw new Error(`createInvoiceForQuote: days until due must be 1–${MAX_DAYS_UNTIL_DUE}`);
  }
  const siteUrl = opts.siteUrl.replace(/\/$/, "");
  const quote: Quote | null = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "createInvoice(quote)");
  if (!quote) throw new Error(`createInvoiceForQuote: quote ${quoteId} not found`);
  if (quote.status === "accepted" || quote.status === "declined") {
    throw new Error(`createInvoiceForQuote: quote ${quoteId} is ${quote.status}`);
  }
  const customer: Customer | null = check(
    await db.from("customers").select("*").eq("id", quote.customer_id).maybeSingle(),
    "createInvoice(customer)",
  );
  if (!customer) throw new Error(`createInvoiceForQuote: customer ${quote.customer_id} not found`);
  if (!customer.email) throw new Error(`createInvoiceForQuote: customer ${customer.id} has no email address`);
  const items = check(
    await db.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true }),
    "createInvoice(items)",
  );

  const lines = billedLines(quote, items ?? []);
  const tax = taxConfig();
  if (tax.enabled && !parseUsAddress(customer.address)?.postal_code) {
    throw new Error(
      "Stripe Tax needs the customer's ZIP code to tax an invoice. Set their address as \"street, city, OH 44116\" and try again.",
    );
  }
  const hash = invoiceHash(lines, customer.email, days, tax);
  const stripe = getStripe();

  let prev: Stripe.Invoice | null = null;
  if (quote.stripe_invoice_id) {
    prev = await stripe.invoices.retrieve(quote.stripe_invoice_id);
    if (prev.status === "paid") {
      throw new Error("The customer has already paid this quote's invoice; refund it instead of re-sending.");
    }
    if (prev.status === "open" && prev.metadata?.items_hash === hash && prev.hosted_invoice_url) {
      if (opts.sendInvoice) await stripe.invoices.sendInvoice(prev.id);
      await markSent(db, quoteId, prev.id, prev.hosted_invoice_url);
      return { id: prev.id, hosted_invoice_url: prev.hosted_invoice_url };
    }
  }

  // A Checkout link the customer still holds must not be payable alongside the invoice
  // (throws, before anything is voided, if they already paid it).
  await expireOpenCheckout(db, quoteId);

  if (prev?.status === "open" || prev?.status === "uncollectible") await stripe.invoices.voidInvoice(prev.id);
  else if (prev?.status === "draft") await stripe.invoices.del(prev.id);

  const stripeCustomer = await ensureStripeCustomer(db, customer);
  const invoice = await stripe.invoices.create(
    {
      customer: stripeCustomer,
      collection_method: "send_invoice",
      days_until_due: days,
      auto_advance: false, // finalized (and sent) below, not by Stripe's timer
      pending_invoice_items_behavior: "exclude",
      automatic_tax: { enabled: tax.enabled },
      currency: "usd",
      description: `Quote ${quoteId.slice(0, 8)} for ${customer.name}`,
      footer: `${siteConfig.name} · ${siteConfig.phone.display} · ${siteUrl}`,
      metadata: { quote_id: quoteId, customer_id: quote.customer_id, items_hash: hash },
    },
    // A new key per previous invoice: re-sending after a void must not replay the voided invoice.
    { idempotencyKey: `quote-invoice-${quoteId}-${hash}-${quote.stripe_invoice_id ?? "first"}` },
  );
  // Remember the draft right away so a crash before finalizing is cleaned up on the next attempt.
  check(
    await db.from("quotes").update({ stripe_invoice_id: invoice.id, stripe_invoice_url: null }).eq("id", quoteId),
    "createInvoice(save draft)",
  );

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await stripe.invoiceItems.create(
      {
        customer: stripeCustomer,
        invoice: invoice.id,
        currency: "usd",
        amount: l.unit_amount_cents * l.quantity,
        description: l.quantity > 1 ? `${l.description} × ${l.quantity}` : l.description,
        // price_total is pre-tax: any sales tax is added on top.
        tax_behavior: "exclusive",
        ...(tax.taxCode ? { tax_code: tax.taxCode } : {}),
        metadata: { quote_id: quoteId },
      },
      { idempotencyKey: `invoice-${invoice.id}-line-${i}` },
    );
  }

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
  if (!finalized.hosted_invoice_url) throw new Error("createInvoiceForQuote: Stripe returned an invoice without a hosted URL");
  if (opts.sendInvoice) await stripe.invoices.sendInvoice(finalized.id);

  await markSent(db, quoteId, finalized.id, finalized.hosted_invoice_url);
  return { id: finalized.id, hosted_invoice_url: finalized.hosted_invoice_url };
}

async function markSent(db: Db, quoteId: string, invoiceId: string, url: string): Promise<void> {
  check(
    await db
      .from("quotes")
      .update({
        stripe_invoice_id: invoiceId,
        stripe_invoice_url: url,
        stripe_checkout_url: null,
        status: "sent",
        sent_at: new Date().toISOString(),
        expires_at: null,
      })
      .eq("id", quoteId),
    "createInvoice(mark sent)",
  );
}

/**
 * Voids the quote's open (or uncollectible) invoice, deletes a leftover draft, and clears
 * `stripe_invoice_url` (the id stays for the record). Does not change the quote's status: callers do.
 * THROWS (leaving the quote alone) if the invoice is already paid: refund instead.
 */
export async function voidInvoiceForQuote(db: Db, quoteId: string): Promise<{ voided: boolean }> {
  const quote = check(
    await db.from("quotes").select("id,stripe_invoice_id").eq("id", quoteId).maybeSingle(),
    "voidInvoice(quote)",
  );
  if (!quote) throw new Error(`voidInvoiceForQuote: quote ${quoteId} not found`);
  let voided = false;
  if (quote.stripe_invoice_id) {
    const stripe = getStripe();
    const invoice: Stripe.Invoice = await stripe.invoices.retrieve(quote.stripe_invoice_id);
    if (invoice.status === "paid") {
      throw new Error("The customer has already paid this quote's invoice; refund it instead.");
    }
    if (invoice.status === "open" || invoice.status === "uncollectible") {
      try {
        await stripe.invoices.voidInvoice(invoice.id);
        voided = true;
      } catch (e) {
        // Lost a race with the customer paying: look again.
        const again = await stripe.invoices.retrieve(invoice.id);
        if (again.status === "paid") throw new Error("The customer paid this invoice while it was being voided; refund it instead.");
        if (again.status !== "void") throw e;
      }
    } else if (invoice.status === "draft") {
      await stripe.invoices.del(invoice.id);
    }
  }
  check(await db.from("quotes").update({ stripe_invoice_url: null }).eq("id", quoteId), "voidInvoice(clear url)");
  return { voided };
}
