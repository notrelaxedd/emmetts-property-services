import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createCheckoutForQuote } from "@/lib/stripe/checkout";
import { siteConfig } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Durable pay link used in quote emails. Stripe Checkout sessions live at most 24 h, but a quote is
 * valid for `settings.quote_valid_days`; this route mints (or reuses) a fresh session on each click.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getSupabaseAdmin();
  const home = new URL("/quote/expired", siteConfig.url);
  if (!db || !/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.redirect(home);

  const { data: quote } = await db.from("quotes").select("id,status,expires_at").eq("id", params.id).maybeSingle();
  if (!quote) return NextResponse.redirect(home);
  if (quote.status === "accepted") return NextResponse.redirect(new URL("/quote/paid", siteConfig.url));
  const stillValid = quote.status === "sent" && (!quote.expires_at || new Date(quote.expires_at) > new Date());
  if (!stillValid) return NextResponse.redirect(home);

  try {
    const { url } = await createCheckoutForQuote(db, quote.id, { siteUrl: siteConfig.url });
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[quote/pay] could not create a checkout session:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(home);
  }
}
