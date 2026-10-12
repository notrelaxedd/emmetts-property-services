import { draftMessage } from "../../ai/claude";
import type { Customer, Quote, QuoteItem, QuoteItemStatus, Settings } from "../../db/types";
import { sendMessage } from "../../email";
import { priceQuote } from "../../pricing";
import type { QuoteItemInput } from "../../pricing";
import { siteConfig } from "../../site-config";
import { createApproval } from "../approvals";
import type { ApprovalHandler, CreateApprovalInput } from "../approvals";
import { getSettings } from "../settings";
import { check, one } from "../types";
import type { Db } from "../types";

// ---------- Shared quote helpers (also used by the fleet `quote` task) ----------

/**
 * Items as `priceQuote` inputs. An owner-priced item (`priced`) keeps the owner's price even when it
 * is a standard service (e.g. a service with `auto_quote = false`), so it is passed as custom.
 */
export function quoteItemInputs(items: Pick<QuoteItem, "crew_size" | "est_hours" | "price" | "is_custom" | "status">[]): QuoteItemInput[] {
  return items.map((i) => ({
    crew_size: i.crew_size,
    est_hours: i.est_hours,
    price: i.price,
    is_custom: i.is_custom || i.status === "priced",
    status: i.status,
  }));
}

/** Items that end up on the Stripe checkout: auto / priced with a positive price. */
export function billableItems<T extends Pick<QuoteItem, "status" | "price">>(items: T[]): T[] {
  return items.filter((i) => (i.status === "auto" || i.status === "priced") && i.price !== null && i.price > 0);
}

const dollars = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/**
 * The `quote` approval card. Payload:
 * `{ quote_id, price_total, needs_owner, items: [{ quote_item_id, description, is_custom, status, crew_size, est_hours, price }] }`.
 */
export function quoteApprovalInput(
  quote: Pick<Quote, "id" | "price_total" | "status" | "rationale">,
  items: QuoteItem[],
  customerName: string,
  createdBy: string,
): CreateApprovalInput {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  return {
    kind: "quote",
    ref_table: "quotes",
    ref_id: quote.id,
    payload: {
      quote_id: quote.id,
      price_total: quote.price_total,
      needs_owner: quote.status === "needs_owner",
      items: sorted.map((i) => ({
        quote_item_id: i.id,
        description: i.description,
        is_custom: i.is_custom,
        status: i.status,
        crew_size: i.crew_size,
        est_hours: i.est_hours,
        price: i.price,
      })),
    },
    title: `Quote for ${customerName} — ${dollars(quote.price_total)}`,
    summary: quote.rationale,
    created_by: createdBy,
  };
}

/**
 * Re-totals a quote from its items with the quote's own wage / margin (owner overrides survive),
 * writes the totals, and returns the fresh quote + items.
 */
export async function recomputeQuoteTotals(
  db: Db,
  quoteId: string,
  settings?: Settings,
): Promise<{ quote: Quote; items: QuoteItem[]; needsOwner: boolean }> {
  const s = settings ?? (await getSettings(db));
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "recomputeQuoteTotals(quote)");
  if (!quote) throw new Error(`recomputeQuoteTotals: quote ${quoteId} not found`);
  const items = check(await db.from("quote_items").select("*").eq("quote_id", quoteId), "recomputeQuoteTotals(items)") ?? [];
  const totals = priceQuote(quoteItemInputs(items), s, { wage: quote.wage ?? undefined, margin: quote.margin ?? undefined });
  const updated = one(
    await db
      .from("quotes")
      .update({
        price_total: totals.price_total,
        labor_total: totals.labor_total,
        fee_total: totals.fee_total,
        profit_total: totals.profit_total,
      })
      .eq("id", quoteId)
      .select("*")
      .single(),
    "recomputeQuoteTotals(update)",
  );
  return { quote: updated, items, needsOwner: items.some((i) => i.status === "needs_owner") };
}

/** Quote statuses whose totals may still change (nothing has gone to the customer yet). */
const OPEN_QUOTE_STATUSES = new Set<Quote["status"]>(["draft", "needs_owner"]);
export const SENT_QUOTE_ERROR = "Quote already sent; decline/refund and re-quote";

/**
 * Why the owner's quote editor (`saveQuote`) must refuse a quote in this status, or null when it may
 * be edited. Once the link has gone out (`sent`) or been paid (`accepted`) an edit would silently
 * change what the customer pays: a sent quote goes through "Revise & re-send" (expires the Stripe
 * session, back to `draft`), a paid one through Refund.
 */
export function quoteEditLockReason(status: Quote["status"]): string | null {
  switch (status) {
    case "sent":
      return "This quote has been sent. Use “Revise & re-send” to change it (the old payment link stops working).";
    case "accepted":
      return "This quote is paid. Refund it and create a new quote instead of editing it.";
    case "declined":
      return "This quote is declined and can't be edited.";
    default:
      return null;
  }
}

// ---------- Customer emails for refer / decline ----------

type Action = "price" | "refer" | "decline";

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

export function referralTemplate(input: { name: string; request: string; partnerName: string | null; partnerEmail: string | null }) {
  // TODO [PARTNER TREE SERVICE — ask owner]: until settings.partner_tree_service_name is set we say "a partner".
  const partner = input.partnerName
    ? `${input.partnerName}${input.partnerEmail ? ` (${input.partnerEmail})` : ""}, a company we trust,`
    : "a trusted partner";
  return {
    subject: `About your request: ${input.request.slice(0, 60)}`,
    body: [
      `Hi ${first(input.name)},`,
      "",
      `Thanks for asking us about "${input.request}". That job is outside what our crew can do safely, so we'll ` +
        `connect you with ${partner} who handles this kind of work.`,
      `Questions? Call or text us at ${siteConfig.phone.display}.`,
      "",
      "Thanks,",
      siteConfig.name,
    ].join("\n"),
  };
}

export function declineTemplate(input: { name: string; request: string }) {
  return {
    subject: `About your request: ${input.request.slice(0, 60)}`,
    body: [
      `Hi ${first(input.name)},`,
      "",
      `Thanks for asking us about "${input.request}". Unfortunately that's not something we can take on right now.`,
      `If there's anything else we can help with, call or text us at ${siteConfig.phone.display}.`,
      "",
      "Thanks,",
      siteConfig.name,
    ].join("\n"),
  };
}

async function emailCustomer(
  db: Db,
  input: { kind: "referral" | "decline"; customer: Customer; quoteId: string; item: QuoteItem; settings: Settings; siteUrl: string; actor: string },
): Promise<void> {
  const { kind, customer, item, settings } = input;
  const already = check(
    await db.from("messages").select("*").eq("quote_id", input.quoteId).eq("kind", kind).eq("status", "sent").limit(1),
    "custom_itemHandler(sent check)",
  );
  if ((already ?? []).length > 0) return; // retry after a successful send

  const fallback =
    kind === "referral"
      ? referralTemplate({
          name: customer.name,
          request: item.description,
          partnerName: settings.partner_tree_service_name,
          partnerEmail: settings.partner_tree_service_email,
        })
      : declineTemplate({ name: customer.name, request: item.description });
  let draft = fallback;
  try {
    const extra: Record<string, string> = { request: item.description };
    if (kind === "referral") {
      extra.partner_name = settings.partner_tree_service_name ?? "a trusted partner (no name yet; do not invent one)";
      if (settings.partner_tree_service_email) extra.partner_email = settings.partner_tree_service_email;
    }
    if (item.partner_note) extra.owner_note = item.partner_note;
    draft = await draftMessage(db, { kind, customer: { name: customer.name, first_name: first(customer.name) }, extra }, { worker: input.actor });
  } catch (e) {
    console.warn(`[approvals] AI ${kind} draft failed, using the plain-text template:`, e instanceof Error ? e.message : e);
  }

  const message = one(
    await db
      .from("messages")
      .insert({
        customer_id: customer.id,
        quote_id: input.quoteId,
        job_id: null,
        channel: "email",
        kind,
        subject: draft.subject,
        body: draft.body,
        status: "queued",
      })
      .select("*")
      .single(),
    "custom_itemHandler(message)",
  );
  const result = await sendMessage(db, message.id, { siteUrl: input.siteUrl });
  if (result.status === "failed") throw new Error(`custom_itemHandler: ${kind} email failed: ${result.error}`);
  if (result.status === "cancelled") console.warn(`[approvals] ${kind} email ${message.id} not sent: ${result.error}`);
}

/**
 * Side effect for an approved / edited "custom_item" approval (the owner's decision on a custom request).
 * Payload: `{ quote_item_id, quote_id, action?: "price" | "refer" | "decline", price?, est_hours?, crew_size?, partner_note? }`.
 * `action` defaults to "price" when a price is given.
 *  - price:   item gets the owner's price / hours / crew, status `priced`.
 *  - refer:   status `referred`, referral email to the customer (partner from settings).
 *  - decline: status `declined`, decline email to the customer.
 * Then the quote is re-totalled. When no item is left `needs_owner`, the quote goes back to `draft` and its
 * `quote` approval is created / refreshed so the owner can send it; if nothing billable is left the quote
 * is marked `declined`.
 * Only while the quote is `draft` / `needs_owner`: once it has been sent, `price` is refused (throws
 * SENT_QUOTE_ERROR before touching anything) and refer / decline update the item + email the customer
 * but leave the quote's totals and status alone.
 */
export const custom_itemHandler: ApprovalHandler = async (db, approval, ctx) => {
  const p = approval.payload;
  const itemId =
    typeof p.quote_item_id === "string" ? p.quote_item_id : approval.ref_table === "quote_items" ? approval.ref_id : null;
  if (!itemId) throw new Error(`custom_itemHandler: approval ${approval.id} has no quote_item_id`);
  const item = check(await db.from("quote_items").select("*").eq("id", itemId).maybeSingle(), "custom_itemHandler(item)");
  if (!item) throw new Error(`custom_itemHandler: quote item ${itemId} not found`);
  const quoteId = item.quote_id;

  const price = num(p.price);
  const action: Action | null =
    p.action === "price" || p.action === "refer" || p.action === "decline" ? p.action : price !== null ? "price" : null;
  if (!action) throw new Error(`custom_itemHandler: approval ${approval.id} needs payload.action (price | refer | decline)`);

  const settings = await getSettings(db);
  const quote = check(await db.from("quotes").select("*").eq("id", quoteId).maybeSingle(), "custom_itemHandler(quote)");
  if (!quote) throw new Error(`custom_itemHandler: quote ${quoteId} not found`);
  const customer = check(await db.from("customers").select("*").eq("id", quote.customer_id).maybeSingle(), "custom_itemHandler(customer)");
  if (!customer) throw new Error(`custom_itemHandler: customer ${quote.customer_id} not found`);
  const note = typeof p.partner_note === "string" && p.partner_note.trim() ? p.partner_note.trim() : item.partner_note;

  // Once the quote has gone out (sent / accepted / expired / declined) the customer's price is fixed:
  // re-totalling it would silently change what the Stripe link charges (or no longer match what was
  // paid). Pricing a new item there needs a new quote; refer / decline only email the customer.
  const open = OPEN_QUOTE_STATUSES.has(quote.status);
  if (action === "price" && !open) {
    throw new Error(`${SENT_QUOTE_ERROR} (quote is ${quote.status}).`);
  }

  if (action === "price") {
    if (price === null || price < 0) throw new Error(`custom_itemHandler: approval ${approval.id} needs a price >= 0`);
    const hours = num(p.est_hours);
    const crew = num(p.crew_size);
    check(
      await db
        .from("quote_items")
        .update({
          price,
          est_hours: hours !== null && hours >= 0 ? hours : item.est_hours,
          crew_size: crew !== null && crew >= 1 ? Math.round(crew) : item.crew_size,
          status: "priced",
          partner_note: note,
        })
        .eq("id", itemId),
      "custom_itemHandler(price)",
    );
  } else {
    const status: QuoteItemStatus = action === "refer" ? "referred" : "declined";
    check(await db.from("quote_items").update({ status, partner_note: note }).eq("id", itemId), `custom_itemHandler(${status})`);
    await emailCustomer(db, {
      kind: action === "refer" ? "referral" : "decline",
      customer,
      quoteId,
      item: { ...item, partner_note: note },
      settings,
      siteUrl: ctx.siteUrl,
      actor: ctx.actor,
    });
  }

  if (!open) return; // already sent / settled: leave the quote's totals exactly as the customer saw them

  const fresh = await recomputeQuoteTotals(db, quoteId, settings);
  if (fresh.needsOwner) return; // other custom items still waiting on the owner

  if (billableItems(fresh.items).length === 0) {
    check(await db.from("quotes").update({ status: "declined" }).eq("id", quoteId), "custom_itemHandler(quote declined)");
    return;
  }
  const draft = one(
    await db.from("quotes").update({ status: "draft" }).eq("id", quoteId).select("*").single(),
    "custom_itemHandler(quote draft)",
  );
  await createApproval(db, quoteApprovalInput(draft, fresh.items, customer.name, ctx.actor));
};
