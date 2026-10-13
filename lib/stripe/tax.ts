/**
 * Stripe Tax switches (TEST MODE ONLY, see ./client.ts). Ohio taxes lawn care / landscaping services, so
 * Checkout and invoices can ask Stripe to compute sales tax, but only once the owner has added an Ohio
 * registration in Stripe Tax: until then `STRIPE_TAX_ENABLED` stays unset and nothing is taxed.
 *
 * Env:
 *  - STRIPE_TAX_ENABLED=true   turn on `automatic_tax` for new Checkout sessions and invoices (default off).
 *  - STRIPE_TAX_CODE=txcd_...  product tax code for every line. TODO [TAX CODE — owner picks]: run
 *                              `npm run stripe:setup` and choose from the candidate codes it prints. Never a
 *                              guessed id. Unset = omitted, so Stripe uses the account's default tax code.
 *
 * Prices are always tax-EXCLUSIVE: `quotes.price_total` is the pre-tax amount and tax is added on top.
 */
export type TaxConfig = {
  /** `automatic_tax: { enabled: true }` on new sessions / invoices. */
  enabled: boolean;
  /** `txcd_…` for each line, or undefined to fall back to the Stripe account default. */
  taxCode: string | undefined;
};

export function taxConfig(env: Record<string, string | undefined> = process.env): TaxConfig {
  const code = env.STRIPE_TAX_CODE?.trim();
  return {
    enabled: env.STRIPE_TAX_ENABLED?.trim().toLowerCase() === "true",
    taxCode: code ? code : undefined,
  };
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The line appended to `quotes.rationale` for the tax Stripe collected on a payment. */
export function salesTaxNote(taxCents: number, source: string): string {
  return `Sales tax collected: ${usd(taxCents)} (${source})`;
}

export type StripeAddress = {
  line1: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country: "US";
};

/**
 * Best-effort split of our single-line `customers.address` into a Stripe address. Stripe Tax needs at
 * least a US ZIP code. Understands "123 Main St, Rocky River, OH 44116" (optionally with ", USA");
 * anything else goes in `line1` only.
 */
export function parseUsAddress(raw: string | null | undefined): StripeAddress | null {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const cleaned = text.replace(/,?\s*(USA|U\.S\.A\.|US|United States)\.?$/i, "").trim();
  const m = cleaned.match(/^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?$/);
  if (m) {
    return { line1: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), postal_code: m[4], country: "US" };
  }
  // "street, city OH 44116" (no comma before the state)
  const m2 = cleaned.match(/^(.+?),\s*(.+?)\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?$/);
  if (m2) {
    return { line1: m2[1].trim(), city: m2[2].trim(), state: m2[3].toUpperCase(), postal_code: m2[4], country: "US" };
  }
  return { line1: cleaned.slice(0, 200), country: "US" };
}
