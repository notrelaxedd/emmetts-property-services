/**
 * Helpers for `scripts/stripe-setup.ts` (`npm run stripe:setup -- --site https://www.eodlawns.com`).
 * Pure functions plus `runStripeSetup`, which takes the Stripe client as an argument so tests can pass a
 * mock. No database, no env reads, never prints the API key.
 */
import type Stripe from "stripe";

/** Every event `lib/stripe/webhook.ts` handles. The setup script registers exactly these. */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "charge.refunded",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
] as const satisfies readonly Stripe.WebhookEndpointCreateParams.EnabledEvent[];

export const WEBHOOK_PATH = "/api/stripe/webhook";

/** Tax code names worth showing the owner when picking STRIPE_TAX_CODE. */
export const TAX_CODE_PATTERN = /landscap|lawn|garden|snow/i;

export type SetupArgs = { site: string | null; live: boolean; help: boolean };

export function parseArgs(argv: string[]): SetupArgs {
  const out: SetupArgs = { site: null, live: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") out.live = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--site") out.site = argv[++i] ?? null;
    else if (a.startsWith("--site=")) out.site = a.slice("--site=".length);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

/**
 * Refuses anything but a test key (`sk_test_` / `rk_test_`) unless `--live` was passed. Returns an error
 * message (never containing the key) or null when it may proceed.
 */
export function checkKey(key: string | undefined, live: boolean): string | null {
  if (!key) return "STRIPE_SECRET_KEY is not set. Run: STRIPE_SECRET_KEY=sk_test_… npx tsx scripts/stripe-setup.ts --site https://www.eodlawns.com";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return null;
  const isLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (isLive && live) return null;
  if (isLive) return "STRIPE_SECRET_KEY is a LIVE key. This project is test mode only; pass --live only when the owner has approved going live.";
  return "STRIPE_SECRET_KEY does not look like a Stripe secret or restricted key (expected sk_test_… or rk_test_…).";
}

export const isLiveKey = (key: string) => key.startsWith("sk_live_") || key.startsWith("rk_live_");

/**
 * Normalises `--site` to the origin Stripe should call: https, no path, and the `www` host for a bare
 * apex domain (eodlawns.com 308-redirects to www.eodlawns.com and Stripe does not follow redirects, so a
 * webhook on the apex would fail every delivery).
 */
export function normaliseSite(input: string): { site: string; warnings: string[] } {
  const warnings: string[] = [];
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error(`--site is not a URL: ${input}`);
  }
  const local = url.hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);
  if (local) {
    warnings.push(
      `${url.hostname} is not reachable from Stripe. For local development use \`stripe listen --forward-to localhost:3000${WEBHOOK_PATH}\` instead.`,
    );
  } else if (url.protocol !== "https:") {
    warnings.push(`Stripe only delivers live webhooks over HTTPS; using https://${url.host}.`);
    url.protocol = "https:";
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    warnings.push(`Ignoring the path in ${raw}; the webhook lives at ${WEBHOOK_PATH} on the site's origin.`);
  }
  let host = url.host;
  if (!local && url.hostname.split(".").length === 2) {
    host = `www.${url.host}`;
    warnings.push(
      `${url.hostname} is the apex domain: it 308-redirects to www.${url.hostname} and Stripe does not follow redirects, so the webhook would never be delivered. Using https://${host}.`,
    );
  }
  return { site: `${url.protocol}//${host}`, warnings };
}

export const webhookUrl = (site: string) => `${site.replace(/\/$/, "")}${WEBHOOK_PATH}`;

/** True when the endpoint already listens to exactly WEBHOOK_EVENTS (order-insensitive). */
export function sameEvents(enabled: readonly string[]): boolean {
  const want = [...WEBHOOK_EVENTS].sort();
  const have = Array.from(new Set(enabled)).sort();
  return want.length === have.length && want.every((e, i) => e === have[i]);
}

/** The Ohio (US-OH) registration among `tax.registrations.list()` results, if any is active or scheduled. */
export function findOhioRegistration(regs: Pick<Stripe.Tax.Registration, "country" | "country_options" | "status">[]) {
  return regs.find(
    (r) => r.country === "US" && r.country_options?.us?.state?.toUpperCase() === "OH" && (r.status === "active" || r.status === "scheduled"),
  );
}

type Log = (line: string) => void;

export type SetupResult = {
  webhook: { action: "created" | "updated" | "unchanged"; id: string; url: string; secret?: string };
  taxActive: boolean | null;
  ohioRegistered: boolean | null;
  taxCodes: { id: string; name: string }[];
  warnings: string[];
};

/**
 * (a) creates or updates the webhook endpoint, printing the signing secret only when it is created;
 * (b) reports Stripe Tax status and the Ohio registration; (c) lists candidate tax codes.
 */
export async function runStripeSetup(
  stripe: Stripe,
  opts: { site: string; apiVersion: string; live: boolean },
  log: Log = console.log,
): Promise<SetupResult> {
  const warnings: string[] = [];
  const warn = (w: string) => {
    warnings.push(w);
    log(`  ! ${w}`);
  };
  const target = webhookUrl(opts.site);
  log(`Stripe ${opts.live ? "LIVE" : "TEST"} mode · webhook ${target}`);

  // (a) webhook endpoint
  log("\n== Webhook endpoint");
  const endpoints: Stripe.WebhookEndpoint[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await stripe.webhookEndpoints.list({ limit: 100, ...(after ? { starting_after: after } : {}) });
    endpoints.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    after = page.data[page.data.length - 1].id;
  }
  const existing = endpoints.find((e) => e.url === target);
  for (const e of endpoints) {
    if (e !== existing && e.url.endsWith(WEBHOOK_PATH)) {
      warn(`Another endpoint also points at this app: ${e.url} (${e.id}, ${e.status}). Delete or disable it in the Dashboard if it is stale (an apex URL never receives events).`);
    }
  }

  let webhook: SetupResult["webhook"];
  if (existing) {
    const needsEvents = !sameEvents(existing.enabled_events);
    const disabled = existing.status !== "enabled";
    if (needsEvents || disabled) {
      await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: [...WEBHOOK_EVENTS],
        ...(disabled ? { disabled: false } : {}),
      });
      log(`  updated ${existing.id}: ${needsEvents ? "events set to the list below" : ""}${needsEvents && disabled ? "; " : ""}${disabled ? "re-enabled" : ""}`);
      webhook = { action: "updated", id: existing.id, url: target };
    } else {
      log(`  ${existing.id} already listens to the right events.`);
      webhook = { action: "unchanged", id: existing.id, url: target };
    }
    log("  Signing secret unchanged (Stripe shows it only at creation). If STRIPE_WEBHOOK_SECRET is lost, reveal or roll it");
    log(`  in Dashboard → Developers → Webhooks → ${existing.id}.`);
    if (existing.api_version && existing.api_version !== opts.apiVersion) {
      warn(`Endpoint API version is ${existing.api_version}, the app's SDK uses ${opts.apiVersion}. Payloads still parse (the invoice handler reads both shapes), but recreating the endpoint pins it to the SDK version.`);
    }
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: target,
      enabled_events: [...WEBHOOK_EVENTS],
      api_version: opts.apiVersion as Stripe.WebhookEndpointCreateParams.ApiVersion,
      description: "Emmett's Property Services: quote payments, invoices, refunds",
      metadata: { app: "emmetts-property-services" },
    });
    webhook = { action: "created", id: created.id, url: target, secret: created.secret };
    log(`  created ${created.id}`);
    if (created.secret) {
      log("");
      log("  >>> Paste into Vercel as STRIPE_WEBHOOK_SECRET (Settings → Environment Variables → Production), then redeploy:");
      log(`  STRIPE_WEBHOOK_SECRET=${created.secret}`);
      log("  Stripe shows this secret only once. It is not saved anywhere by this script.");
    } else {
      warn("Stripe did not return a signing secret; reveal it in the Dashboard.");
    }
  }
  log(`  events: ${WEBHOOK_EVENTS.join(", ")}`);

  // (b) Stripe Tax
  log("\n== Stripe Tax");
  let taxActive: boolean | null = null;
  let defaultCode: string | null = null;
  try {
    const settings = await stripe.tax.settings.retrieve();
    taxActive = settings.status === "active";
    defaultCode = settings.defaults?.tax_code ?? null;
    log(`  status: ${settings.status}${taxActive ? "" : " (finish Dashboard → Tax → Settings: head office address + default tax code)"}`);
    log(`  default tax code: ${defaultCode ?? "none"}; default tax behavior: ${settings.defaults?.tax_behavior ?? "none"}`);
  } catch (e) {
    warn(`Could not read Stripe Tax settings (${e instanceof Error ? e.message : String(e)}). Open Dashboard → Tax to set it up.`);
  }

  let ohioRegistered: boolean | null = null;
  try {
    const regs = await stripe.tax.registrations.list({ limit: 100, status: "all" });
    const us = regs.data.filter((r) => r.country === "US").map((r) => `${r.country_options?.us?.state ?? "?"} (${r.status})`);
    log(`  US registrations: ${us.length ? us.join(", ") : "none"}`);
    ohioRegistered = !!findOhioRegistration(regs.data);
    if (!ohioRegistered) {
      warn("Ohio (US-OH) is not registered in Stripe Tax, so no Ohio sales tax will be collected. Get an Ohio service vendor's license from the Ohio Department of Taxation (Ohio Business Gateway; ask your accountant), then add it in Dashboard → Tax → Registrations → Add registration → United States → Ohio. Keep STRIPE_TAX_ENABLED unset until then.");
    } else {
      log("  Ohio registration found. Set STRIPE_TAX_ENABLED=true in Vercel to collect tax on new quotes.");
    }
  } catch (e) {
    warn(`Could not list tax registrations (${e instanceof Error ? e.message : String(e)}).`);
  }

  // (c) candidate tax codes
  log("\n== Candidate tax codes for STRIPE_TAX_CODE");
  const taxCodes: SetupResult["taxCodes"] = [];
  try {
    let cursor: string | undefined;
    for (;;) {
      const page = await stripe.taxCodes.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      for (const c of page.data) if (TAX_CODE_PATTERN.test(c.name)) taxCodes.push({ id: c.id, name: c.name });
      if (!page.has_more || page.data.length === 0) break;
      cursor = page.data[page.data.length - 1].id;
    }
    if (taxCodes.length) {
      for (const c of taxCodes) log(`  ${c.id}  ${c.name}${c.id === defaultCode ? "  (account default)" : ""}`);
      log("  Pick the one that matches the service (check its description in Dashboard → Tax → Tax codes), then set");
      log("  STRIPE_TAX_CODE=<id> in Vercel. Leave it unset to use the account default above.");
    } else {
      log("  No codes matched /landscap|lawn|garden|snow/i. Browse Dashboard → Tax → Tax codes.");
    }
  } catch (e) {
    warn(`Could not list tax codes (${e instanceof Error ? e.message : String(e)}).`);
  }

  return { webhook, taxActive, ohioRegistered, taxCodes, warnings };
}
