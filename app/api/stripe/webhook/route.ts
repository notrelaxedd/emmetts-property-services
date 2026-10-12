/**
 * Stripe webhook endpoint (TEST MODE ONLY; going live is the owner's explicit call).
 * Local dev: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then copy the printed
 * `whsec_...` into STRIPE_WEBHOOK_SECRET.
 */
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/webhook";
import { requireSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return raw.replace(/\/$/, "");
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });

  const body = await req.text(); // raw body: required for signature verification

  let stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    console.error("[stripe] client unavailable:", e);
    return NextResponse.json({ error: "stripe not configured" }, { status: 500 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (e) {
    console.warn("[stripe] webhook signature verification failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(requireSupabaseAdmin(), event, { siteUrl: siteUrl() });
    if (!result.processed) {
      // Persisted but the handler failed: logged and left with processed_at = null for reprocessing.
      console.error(`[stripe] event ${event.id} stored but not processed: ${result.error}`);
    }
  } catch (e) {
    // Could not persist the event: ask Stripe to retry.
    console.error(`[stripe] could not persist event ${event.id}:`, e);
    return NextResponse.json({ error: "could not record event" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
