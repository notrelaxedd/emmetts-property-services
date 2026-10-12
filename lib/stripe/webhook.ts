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
    await dispatch(db, event, ctx);
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

async function dispatch(db: Db, event: Stripe.Event, _ctx: Ctx): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onCheckoutPaid(db, event.data.object);
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

async function onCheckoutPaid(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return; // e.g. async payment still pending
  const quoteId = session.metadata?.quote_id;
  if (!quoteId) {
    console.warn(`[stripe] checkout session ${session.id} has no quote_id metadata; ignoring`);
    return;
  }
  const quote = await getQuote(db, quoteId);
  if (!quote) throw new Error(`checkout session ${session.id}: quote ${quoteId} not found`);

  const now = new Date().toISOString();
  check(
    await db
      .from("quotes")
      .update({
        status: "accepted",
        accepted_at: quote.accepted_at ?? now,
        stripe_payment_intent_id: idOf(session.payment_intent) ?? quote.stripe_payment_intent_id,
      })
      .eq("id", quoteId),
    "stripe(accept quote)",
  );
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
