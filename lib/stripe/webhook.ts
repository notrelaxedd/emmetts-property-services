/**
 * Stripe webhook event processing. TEST MODE ONLY (see ./client.ts): going live is the owner's
 * explicit call.
 *
 * Idempotent through the `stripe_events` table (unique `stripe_event_id`): an event already marked
 * processed is a no-op. An event that was stored but failed to process keeps `processed_at = null`
 * and is retried when Stripe redelivers it, or via `reprocessPendingStripeEvents`.
 */
import type Stripe from "stripe";
import type { Quote } from "../db/types";
import { createApproval } from "../ops/approvals";
import { createJobFromQuote } from "../ops/jobs";
import { check, one } from "../ops/types";
import type { Db } from "../ops/types";
import { appendNote } from "./checkout";

export type StripeEventResult = {
  /** True when this event was already fully processed before. */
  duplicate: boolean;
  /** False when the handler threw; the event stays stored with `processed_at = null`. */
  processed: boolean;
  error?: string;
};

type Ctx = { siteUrl: string };
/** Ctx plus the `stripe_events` row being processed (alerts point at it). */
type DispatchCtx = Ctx & { eventRowId: string };

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

/**
 * Records the event, runs its handler, marks it processed. THROWS only if the event could not be
 * persisted (callers should answer 500 so Stripe retries). Handler failures are logged and returned.
 */
export async function handleStripeEvent(db: Db, event: Stripe.Event, ctx: Ctx): Promise<StripeEventResult> {
  const existing = check(
    await db.from("stripe_events").select("*").eq("stripe_event_id", event.id).maybeSingle(),
    "stripe_events(lookup)",
  );
  if (existing?.processed_at) return { duplicate: true, processed: true };

  const rowId =
    existing?.id ??
    one(
      await db
        .from("stripe_events")
        .insert({
          stripe_event_id: event.id,
          type: event.type,
          processed_at: null,
          payload: event as unknown as Record<string, unknown>,
        })
        .select("*")
        .single(),
      "stripe_events(insert)",
    ).id;

  try {
    await dispatch(db, event, { ...ctx, eventRowId: rowId });
    check(
      await db.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", rowId),
      "stripe_events(mark processed)",
    );
    return { duplicate: false, processed: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[stripe] failed to process event ${event.id} (${event.type}): ${error}`);
    return { duplicate: false, processed: false, error };
  }
}

/** Re-runs every stored event that never finished (for a cron / owner button). */
export async function reprocessPendingStripeEvents(db: Db, ctx: Ctx): Promise<StripeEventResult[]> {
  const rows = check(
    await db.from("stripe_events").select("*").is("processed_at", null).order("created_at", { ascending: true }),
    "stripe_events(pending)",
  );
  const out: StripeEventResult[] = [];
  for (const r of rows ?? []) out.push(await handleStripeEvent(db, r.payload as unknown as Stripe.Event, ctx));
  return out;
}

async function dispatch(db: Db, event: Stripe.Event, ctx: DispatchCtx): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onCheckoutPaid(db, event.data.object, ctx);
    case "checkout.session.expired":
      return onCheckoutExpired(db, event.data.object);
    case "charge.refunded":
      return onChargeRefunded(db, event.data.object);
    default:
      return; // unknown events are recorded and marked processed
  }
}

async function getQuote(db: Db, id: string): Promise<Quote | null> {
  return check(await db.from("quotes").select("*").eq("id", id).maybeSingle(), "stripe(quote lookup)");
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Payment problems the owner must look at: a `quote` approval (no autopilot), keyed to the Stripe
 * event row so a redelivery refreshes the same card. Approving / rejecting it is a no-op on an
 * accepted quote (see quoteHandler / rejectQuote); it is there to be seen.
 */
async function raisePaymentAlert(
  db: Db,
  ctx: DispatchCtx,
  input: { quoteId: string; title: string; summary: string; payload: Record<string, unknown> },
): Promise<void> {
  await createApproval(db, {
    kind: "quote",
    ref_table: "stripe_events",
    ref_id: ctx.eventRowId,
    payload: { quote_id: input.quoteId, ...input.payload },
    title: input.title,
    summary: input.summary,
    created_by: "stripe-webhook",
  });
}

async function onCheckoutPaid(db: Db, session: Stripe.Checkout.Session, ctx: DispatchCtx): Promise<void> {
  if (session.payment_status !== "paid") return; // e.g. async payment still pending
  const quoteId = session.metadata?.quote_id;
  if (!quoteId) {
    console.warn(`[stripe] checkout session ${session.id} has no quote_id metadata; ignoring`);
    return;
  }
  const quote = await getQuote(db, quoteId);
  if (!quote) throw new Error(`checkout session ${session.id}: quote ${quoteId} not found`);

  const pi = idOf(session.payment_intent);
  const paid = typeof session.amount_total === "number" ? session.amount_total : null;

  // A second, different payment for a quote that is already paid: keep the first payment on the quote
  // (refunds and the job hang off it) and make the owner refund this one by hand.
  if (quote.status === "accepted" && quote.stripe_payment_intent_id && pi && quote.stripe_payment_intent_id !== pi) {
    const note = `WARNING: second payment ${pi}${paid !== null ? ` (${usd(paid)})` : ""} received for this already-paid quote (checkout ${session.id}) — refund manually in Stripe.`;
    if (!quote.rationale?.includes(pi)) {
      check(
        await db.from("quotes").update({ rationale: appendNote(quote.rationale, note) }).eq("id", quoteId),
        "stripe(second payment note)",
      );
    }
    console.error(`[stripe] quote ${quoteId}: ${note}`);
    await raisePaymentAlert(db, ctx, {
      quoteId,
      title: "Second payment received — refund manually",
      summary: note,
      payload: { alert: "double_payment", payment_intent: pi, first_payment_intent: quote.stripe_payment_intent_id, checkout_session: session.id, amount_paid: paid },
    });
    return;
  }

  // The money arrived, so the quote is accepted either way; a different amount (the quote was edited
  // after the link went out, or an old link was paid) is flagged loudly for the owner.
  const expected = Math.round(quote.price_total * 100);
  const mismatch = paid !== null && paid !== expected;
  const mismatchNote = mismatch
    ? `WARNING: Paid amount differs from quote — customer paid ${usd(paid)} but the quote total is ${usd(expected)} (checkout ${session.id}). Refund or collect the difference.`
    : null;

  const now = new Date().toISOString();
  check(
    await db
      .from("quotes")
      .update({
        status: "accepted",
        accepted_at: quote.accepted_at ?? now,
        stripe_payment_intent_id: pi ?? quote.stripe_payment_intent_id,
        ...(mismatchNote && !quote.rationale?.includes(session.id) ? { rationale: appendNote(quote.rationale, mismatchNote) } : {}),
      })
      .eq("id", quoteId),
    "stripe(accept quote)",
  );
  if (mismatchNote) {
    console.error(`[stripe] quote ${quoteId}: ${mismatchNote}`);
    await raisePaymentAlert(db, ctx, {
      quoteId,
      title: "Paid amount differs from quote",
      summary: mismatchNote,
      payload: { alert: "amount_mismatch", payment_intent: pi, checkout_session: session.id, amount_paid: paid, amount_expected: expected },
    });
  }
  check(await db.from("leads").update({ status: "won" }).eq("id", quote.lead_id), "stripe(lead won)");
  await createJobFromQuote(db, quoteId); // idempotent; enqueues the `schedule` task
}

async function onCheckoutExpired(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  const quoteId = session.metadata?.quote_id;
  if (!quoteId) return;
  const quote = await getQuote(db, quoteId);
  // Only the quote's *current* session counts (we expire superseded sessions ourselves). A Checkout session
  // expiring (24 h) does NOT expire the quote: the emailed /quote/pay/<id> link mints a new session until
  // `quotes.expires_at`, which the host worker enforces. Just drop the stale URL.
  if (!quote || quote.status !== "sent" || quote.stripe_checkout_id !== session.id) return;
  check(await db.from("quotes").update({ stripe_checkout_url: null }).eq("id", quoteId), "stripe(clear stale checkout url)");
}

async function onChargeRefunded(db: Db, charge: Stripe.Charge): Promise<void> {
  const pi = idOf(charge.payment_intent);
  if (!pi) return;
  const rows = check(
    await db.from("quotes").select("*").eq("stripe_payment_intent_id", pi).limit(1),
    "stripe(refund quote lookup)",
  );
  const quote = rows?.[0];
  if (!quote || quote.rationale?.includes(charge.id)) return;
  const amount = (charge.amount_refunded / 100).toFixed(2);
  check(
    await db
      .from("quotes")
      .update({ rationale: appendNote(quote.rationale, `Stripe refund recorded on charge ${charge.id}: $${amount} refunded.`) })
      .eq("id", quote.id),
    "stripe(refund note)",
  );
}
