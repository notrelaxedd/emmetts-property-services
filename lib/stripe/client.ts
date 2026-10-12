/**
 * Stripe client singleton.
 *
 * TEST MODE ONLY. This project is wired to Stripe *test* keys (`sk_test_...`). Going live is the
 * owner's explicit call: it means swapping the keys in the environment, nothing in code, and there
 * is deliberately no live-mode switch here. If a non-test key is ever configured we warn loudly.
 *
 * Env: STRIPE_SECRET_KEY (required), STRIPE_WEBHOOK_SECRET (used by the webhook route).
 */
import Stripe from "stripe";

let cached: Stripe | null = null;
let warned = false;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add your Stripe TEST secret key (sk_test_...) to the environment.",
    );
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_") && !warned) {
    warned = true;
    console.warn(
      "[stripe] WARNING: STRIPE_SECRET_KEY does not look like a TEST key (expected sk_test_...). " +
        "This app is test-mode only until the owner explicitly approves going live.",
    );
  }
  cached = new Stripe(key, {
    // Pin to the API version this SDK release was generated against (not an older hardcoded one).
    apiVersion: Stripe.API_VERSION,
    typescript: true,
    maxNetworkRetries: 2,
    appInfo: { name: "emmetts-property-services" },
  });
  return cached;
}

/** Test helper: forget the cached client so env changes are picked up. */
export function resetStripeClient(): void {
  cached = null;
  warned = false;
}
