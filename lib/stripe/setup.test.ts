import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  checkKey,
  findOhioRegistration,
  normaliseSite,
  parseArgs,
  runStripeSetup,
  sameEvents,
  WEBHOOK_EVENTS,
  webhookUrl,
} from "./setup";

describe("WEBHOOK_EVENTS", () => {
  it("is exactly the events the app registers", () => {
    expect([...WEBHOOK_EVENTS]).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired",
      "charge.refunded",
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.voided",
      "invoice.marked_uncollectible",
    ]);
  });
  it("every registered event has a case in the webhook dispatcher", () => {
    const src = readFileSync(resolve(__dirname, "webhook.ts"), "utf8");
    for (const e of WEBHOOK_EVENTS) expect(src, e).toContain(`case "${e}":`);
  });
  it("sameEvents ignores order and duplicates", () => {
    expect(sameEvents([...WEBHOOK_EVENTS].reverse())).toBe(true);
    expect(sameEvents([...WEBHOOK_EVENTS, "invoice.paid"])).toBe(true);
    expect(sameEvents(WEBHOOK_EVENTS.slice(0, 4))).toBe(false);
    expect(sameEvents([...WEBHOOK_EVENTS, "customer.created"])).toBe(false);
  });
});

describe("normaliseSite", () => {
  it("keeps https://www.eodlawns.com as is", () => {
    expect(normaliseSite("https://www.eodlawns.com")).toEqual({ site: "https://www.eodlawns.com", warnings: [] });
    expect(normaliseSite("https://www.eodlawns.com/").site).toBe("https://www.eodlawns.com");
    expect(webhookUrl("https://www.eodlawns.com")).toBe("https://www.eodlawns.com/api/stripe/webhook");
  });
  it("moves the apex to www and warns that the apex 308-redirects and Stripe does not follow redirects", () => {
    const { site, warnings } = normaliseSite("https://eodlawns.com");
    expect(site).toBe("https://www.eodlawns.com");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/apex/);
    expect(warnings[0]).toMatch(/308/);
    expect(warnings[0]).toMatch(/does not follow redirects/);
  });
  it("adds https, upgrades http and drops a path", () => {
    expect(normaliseSite("eodlawns.com").site).toBe("https://www.eodlawns.com");
    const http = normaliseSite("http://www.eodlawns.com/api/stripe/webhook");
    expect(http.site).toBe("https://www.eodlawns.com");
    expect(http.warnings.join(" ")).toMatch(/HTTPS/);
    expect(http.warnings.join(" ")).toMatch(/Ignoring the path/);
  });
  it("warns that localhost is unreachable and points at stripe listen", () => {
    const local = normaliseSite("http://localhost:3000");
    expect(local.site).toBe("http://localhost:3000");
    expect(local.warnings[0]).toMatch(/stripe listen/);
  });
  it("rejects garbage", () => {
    expect(() => normaliseSite("https://")).toThrow(/not a URL/);
  });
});

describe("parseArgs / checkKey", () => {
  it("parses --site in both forms and --live", () => {
    expect(parseArgs(["--site", "https://www.eodlawns.com"])).toEqual({ site: "https://www.eodlawns.com", live: false, help: false });
    expect(parseArgs(["--site=https://x.test", "--live"])).toMatchObject({ site: "https://x.test", live: true });
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
  });
  it("accepts test keys, refuses live keys without --live, and never echoes the key", () => {
    expect(checkKey("sk_test_abc", false)).toBeNull();
    expect(checkKey("rk_test_abc", false)).toBeNull();
    expect(checkKey(undefined, false)).toMatch(/not set/);
    const live = checkKey("sk_live_SUPERSECRET", false);
    expect(live).toMatch(/LIVE key/);
    expect(live).not.toContain("SUPERSECRET");
    expect(checkKey("sk_live_SUPERSECRET", true)).toBeNull();
    expect(checkKey("pk_test_abc", false)).toMatch(/does not look like/);
    expect(checkKey("pk_test_abc", true)).toMatch(/does not look like/);
  });
});

describe("findOhioRegistration", () => {
  const reg = (state: string, status = "active") => ({ country: "US", status, country_options: { us: { state, type: "state_sales_tax" } } });
  it("finds an active or scheduled US-OH registration only", () => {
    expect(findOhioRegistration([reg("PA"), reg("OH")] as never)).toBeTruthy();
    expect(findOhioRegistration([reg("OH", "scheduled")] as never)).toBeTruthy();
    expect(findOhioRegistration([reg("OH", "expired"), reg("PA")] as never)).toBeUndefined();
    expect(findOhioRegistration([])).toBeUndefined();
  });
});

function fakeStripe(over: { endpoints?: Partial<Stripe.WebhookEndpoint>[]; regs?: unknown[]; taxStatus?: string } = {}) {
  const codes = [
    { id: "txcd_00000000", name: "Nontaxable" },
    { id: "txcd_A", name: "Landscaping Services" },
    { id: "txcd_B", name: "General - Services" },
    { id: "txcd_C", name: "Lawn Care Services" },
    { id: "txcd_D", name: "Snow Removal Services" },
  ];
  const s = {
    webhookEndpoints: {
      list: vi.fn().mockResolvedValue({ data: over.endpoints ?? [], has_more: false }),
      create: vi.fn().mockResolvedValue({ id: "we_new", secret: "whsec_created_once" }),
      update: vi.fn().mockResolvedValue({ id: "we_1" }),
    },
    tax: {
      settings: { retrieve: vi.fn().mockResolvedValue({ status: over.taxStatus ?? "active", defaults: { tax_code: "txcd_B", tax_behavior: "exclusive" } }) },
      registrations: { list: vi.fn().mockResolvedValue({ data: over.regs ?? [], has_more: false }) },
    },
    taxCodes: {
      // Two pages of two/three codes to exercise pagination.
      list: vi.fn().mockImplementation(async (p: { starting_after?: string }) =>
        p.starting_after ? { data: codes.slice(3), has_more: false } : { data: codes.slice(0, 3), has_more: true },
      ),
    },
  };
  return s;
}

describe("runStripeSetup", () => {
  const opts = { site: "https://www.eodlawns.com", apiVersion: "2026-09-30.endive", live: false };

  it("creates the endpoint, prints the signing secret once, warns when Ohio is missing, lists candidate tax codes", async () => {
    const stripe = fakeStripe({ regs: [{ country: "US", status: "active", country_options: { us: { state: "PA" } } }] });
    const lines: string[] = [];
    const res = await runStripeSetup(stripe as unknown as Stripe, opts, (l) => lines.push(l));
    expect(stripe.webhookEndpoints.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.eodlawns.com/api/stripe/webhook", enabled_events: [...WEBHOOK_EVENTS], api_version: opts.apiVersion }),
    );
    expect(res.webhook).toMatchObject({ action: "created", id: "we_new", secret: "whsec_created_once" });
    const out = lines.join("\n");
    expect(out.match(/whsec_created_once/g)).toHaveLength(1);
    expect(out).toMatch(/Paste into Vercel as STRIPE_WEBHOOK_SECRET/);
    expect(res.taxActive).toBe(true);
    expect(res.ohioRegistered).toBe(false);
    expect(res.warnings.join(" ")).toMatch(/Ohio \(US-OH\) is not registered/);
    expect(res.taxCodes.map((c) => c.id)).toEqual(["txcd_A", "txcd_C", "txcd_D"]);
    expect(stripe.taxCodes.list).toHaveBeenCalledTimes(2);
    expect(stripe.taxCodes.list.mock.calls[1][0]).toMatchObject({ limit: 100, starting_after: "txcd_B" });
  });

  it("updates an existing endpoint's events without printing any secret, and flags a stale apex endpoint", async () => {
    const stripe = fakeStripe({
      endpoints: [
        { id: "we_1", url: "https://www.eodlawns.com/api/stripe/webhook", enabled_events: ["checkout.session.completed"], status: "enabled", api_version: "2026-09-30.endive" },
        { id: "we_apex", url: "https://eodlawns.com/api/stripe/webhook", enabled_events: ["*"], status: "enabled", api_version: null },
      ],
      regs: [{ country: "US", status: "active", country_options: { us: { state: "OH" } } }],
    });
    const lines: string[] = [];
    const res = await runStripeSetup(stripe as unknown as Stripe, opts, (l) => lines.push(l));
    expect(stripe.webhookEndpoints.create).not.toHaveBeenCalled();
    expect(stripe.webhookEndpoints.update).toHaveBeenCalledWith("we_1", { enabled_events: [...WEBHOOK_EVENTS] });
    expect(res.webhook).toEqual({ action: "updated", id: "we_1", url: "https://www.eodlawns.com/api/stripe/webhook" });
    expect(lines.join("\n")).not.toMatch(/whsec_/);
    expect(res.warnings.join(" ")).toMatch(/eodlawns\.com\/api\/stripe\/webhook \(we_apex/);
    expect(res.ohioRegistered).toBe(true);
  });

  it("leaves a correct endpoint alone and re-enables a disabled one", async () => {
    const ok = fakeStripe({ endpoints: [{ id: "we_1", url: "https://www.eodlawns.com/api/stripe/webhook", enabled_events: [...WEBHOOK_EVENTS], status: "enabled" }] });
    expect((await runStripeSetup(ok as unknown as Stripe, opts, () => {})).webhook.action).toBe("unchanged");
    expect(ok.webhookEndpoints.update).not.toHaveBeenCalled();

    const off = fakeStripe({ endpoints: [{ id: "we_1", url: "https://www.eodlawns.com/api/stripe/webhook", enabled_events: [...WEBHOOK_EVENTS], status: "disabled" }] });
    await runStripeSetup(off as unknown as Stripe, opts, () => {});
    expect(off.webhookEndpoints.update).toHaveBeenCalledWith("we_1", { enabled_events: [...WEBHOOK_EVENTS], disabled: false });
  });

  it("keeps going when Stripe Tax isn't set up", async () => {
    const stripe = fakeStripe();
    stripe.tax.settings.retrieve.mockRejectedValue(new Error("Stripe Tax is not enabled"));
    const res = await runStripeSetup(stripe as unknown as Stripe, opts, () => {});
    expect(res.taxActive).toBeNull();
    expect(res.warnings.join(" ")).toMatch(/Could not read Stripe Tax settings/);
    expect(res.taxCodes.length).toBe(3);
  });
});
