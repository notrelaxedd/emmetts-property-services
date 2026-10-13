/**
 * One-off Stripe account setup for the quote / invoice integration. Run it on your own machine (it needs
 * to reach api.stripe.com):
 *
 *   STRIPE_SECRET_KEY=sk_test_… npx tsx scripts/stripe-setup.ts --site https://www.eodlawns.com
 *   (or: STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --site https://www.eodlawns.com)
 *
 * (a) creates or updates the webhook endpoint at <site>/api/stripe/webhook with the events the app handles,
 *     printing the signing secret ONLY when the endpoint is created (Stripe returns it once);
 * (b) reports whether Stripe Tax is active, its default tax code, and warns if Ohio is not registered;
 * (c) lists tax codes matching landscaping / lawn / garden / snow so you can pick STRIPE_TAX_CODE.
 *
 * Test keys only (sk_test_ / rk_test_) unless you pass --live. Never prints the key. No database access.
 * Re-running is safe: it updates the existing endpoint instead of creating a second one.
 * Helpers and tests: lib/stripe/setup.ts, lib/stripe/setup.test.ts. Docs: docs/STRIPE.md.
 */
import Stripe from "stripe";
import { checkKey, isLiveKey, normaliseSite, parseArgs, runStripeSetup } from "../lib/stripe/setup";

const USAGE = `Usage: STRIPE_SECRET_KEY=sk_test_… npx tsx scripts/stripe-setup.ts --site https://www.eodlawns.com [--live]`;

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const keyError = checkKey(key, args.live);
  if (keyError || !key) {
    console.error(`Refusing to run: ${keyError}`);
    return 1;
  }
  const live = isLiveKey(key);
  if (live) console.warn("!!! LIVE MODE: this changes your real Stripe account (--live was passed).");

  const rawSite = args.site ?? process.env.NEXT_PUBLIC_SITE_URL ?? null;
  if (!rawSite) {
    console.error("Pass --site https://www.eodlawns.com (or set NEXT_PUBLIC_SITE_URL).");
    console.error(USAGE);
    return 2;
  }
  const { site, warnings } = normaliseSite(rawSite);
  for (const w of warnings) console.warn(`! ${w}`);

  const stripe = new Stripe(key, { apiVersion: Stripe.API_VERSION, maxNetworkRetries: 2, appInfo: { name: "emmetts-property-services/setup" } });
  const result = await runStripeSetup(stripe, { site, apiVersion: Stripe.API_VERSION, live });

  console.log("\n== Summary");
  console.log(`  webhook: ${result.webhook.action} ${result.webhook.id} → ${result.webhook.url}`);
  console.log(`  Stripe Tax: ${result.taxActive === null ? "unknown" : result.taxActive ? "active" : "not active"}; Ohio registered: ${result.ohioRegistered === null ? "unknown" : result.ohioRegistered ? "yes" : "NO"}`);
  console.log(`  candidate tax codes: ${result.taxCodes.length}`);
  if (result.warnings.length) console.log(`  ${result.warnings.length} warning(s) above.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    // Stripe errors carry no key material; print the message only.
    console.error(`stripe-setup failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
