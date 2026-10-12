import { draftMessage } from "../../ai/claude";
import type { Message, Quote, QuoteItem } from "../../db/types";
import { sendMessage } from "../../email";
import { siteConfig } from "../../site-config";
import { createCheckoutForQuote } from "../../stripe/checkout";
import type { ApprovalHandler } from "../approvals";
import { getSettings } from "../settings";
import { check, one } from "../types";
import type { Db } from "../types";

const money = (n: number) => `$${n.toFixed(2)}`;

/** Billed items (priced + positive price), in display order. */
function billedItems(items: QuoteItem[]): QuoteItem[] {
  return items
    .filter((i) => (i.status === "auto" || i.status === "priced") && i.price !== null && i.price > 0)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Plain-text email used when the AI draft fails or the AI budget cap is hit. */
export function fallbackQuoteEmail(input: {
  firstName: string;
  items: { description: string; price: number }[];
  total: number;
  checkoutUrl: string;
  validDays: number;
}): { subject: string; body: string } {
  const lines = input.items.map((i) => `- ${i.description}: ${money(i.price)}`).join("\n");
  const body = [
    `Hi ${input.firstName},`,
    "",
    "Thanks for asking Emmett's Property Services for a quote. Here is what we priced for your property:",
    "",
    lines,
    "",
    `Total: ${money(input.total)}`,
    "",
    `To accept, pay securely online by card: ${input.checkoutUrl}`,
    `This quote is good for ${input.validDays} days. Once payment comes through we'll reach out to schedule your job.`,
    "",
    `Questions? Call us at ${siteConfig.phone.display}.`,
    "",
    "Thanks,",
    "Emmett's Property Services",
  ].join("\n");
  return { subject: "Your quote from Emmett's Property Services", body };
}

/**
 * Side effect for an approved / edited "quote" approval: create the Stripe Checkout link, email it
 * to the customer, and mark the quote `sent`. Any owner edits (e.g. a `price_total` override) were
 * already written to the quote by the admin UI, so nothing is re-priced here.
 * Stripe is TEST MODE ONLY (see lib/stripe/client.ts).
 */
export const quoteHandler: ApprovalHandler = async (db, approval, ctx) => {
  const quoteId = approval.ref_table === "quotes" ? approval.ref_id : String(approval.payload.quote_id ?? approval.ref_id);
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "quoteHandler(quote)");
  if (!quote) throw new Error(`quoteHandler: quote ${quoteId} not found`);
  if (quote.status === "accepted") {
    console.warn(`[approvals] quote ${quoteId} is already accepted; not sending again`);
    return;
  }
  const customer = check(
    await db.from("customers").select("*").eq("id", quote.customer_id).maybeSingle(),
    "quoteHandler(customer)",
  );
  if (!customer) throw new Error(`quoteHandler: customer ${quote.customer_id} not found`);
  const items = billedItems(
    check(await db.from("quote_items").select("*").eq("quote_id", quoteId), "quoteHandler(items)") ?? [],
  );
  const settings = await getSettings(db);

  const checkout = await createCheckoutForQuote(db, quoteId, { siteUrl: ctx.siteUrl });

  const draft = await draftQuoteEmail(db, quote, customer.name, items, checkout.url, settings.quote_valid_days);

  // Reuse an unsent quote message (a retry after a partial failure) instead of piling up duplicates.
  const pending = check(
    await db
      .from("messages")
      .select("*")
      .eq("quote_id", quoteId)
      .eq("kind", "quote")
      .neq("status", "sent")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    "quoteHandler(pending message)",
  );
  const fields = {
    customer_id: quote.customer_id,
    quote_id: quoteId,
    channel: "email" as const,
    kind: "quote" as const,
    subject: draft.subject,
    body: draft.body,
    status: "queued" as const,
    error: null,
  };
  const message: Message = pending
    ? one(await db.from("messages").update(fields).eq("id", pending.id).select("*").single(), "quoteHandler(update message)")
    : one(await db.from("messages").insert({ ...fields, job_id: null }).select("*").single(), "quoteHandler(insert message)");

  const result = await sendMessage(db, message.id, { siteUrl: ctx.siteUrl });
  if (result.status !== "sent") throw new Error(`quoteHandler: quote email was not sent (${result.status}: ${result.error})`);

  const now = new Date();
  check(
    await db
      .from("quotes")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        expires_at: new Date(now.getTime() + settings.quote_valid_days * 86_400_000).toISOString(),
      })
      .eq("id", quoteId),
    "quoteHandler(mark sent)",
  );
};

async function draftQuoteEmail(
  db: Db,
  quote: Quote,
  customerName: string,
  items: QuoteItem[],
  checkoutUrl: string,
  validDays: number,
): Promise<{ subject: string; body: string }> {
  const priced = items.map((i) => ({ description: i.description, price: i.price as number }));
  const fallback = fallbackQuoteEmail({
    firstName: customerName.split(/\s+/)[0] || customerName,
    items: priced,
    total: quote.price_total,
    checkoutUrl,
    validDays,
  });
  try {
    const draft = await draftMessage(db, {
      kind: "quote",
      customer: { name: customerName, first_name: customerName.split(/\s+/)[0] },
      extra: {
        checkout_url: checkoutUrl,
        price_total: money(quote.price_total),
        items: priced.map((i) => `${i.description}: ${money(i.price)}`).join("; "),
      },
    });
    // The link is the whole point: never send a quote email without it.
    const body = draft.body.includes(checkoutUrl) ? draft.body : `${draft.body}\n\nPay securely online: ${checkoutUrl}`;
    return { subject: draft.subject, body };
  } catch (e) {
    console.warn("[approvals] AI quote draft failed, using the plain-text template:", e instanceof Error ? e.message : e);
    return fallback;
  }
}
