/** The Stripe webhook route's status codes: Stripe only retries on a non-2xx answer. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ handle: vi.fn(), constructEvent: vi.fn() }));
vi.mock("@/lib/stripe/webhook", () => ({ handleStripeEvent: m.handle }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: () => ({ webhooks: { constructEvent: m.constructEvent } }) }));
vi.mock("@/lib/supabase/admin", () => ({ requireSupabaseAdmin: () => ({}) }));

import { POST } from "../../app/api/stripe/webhook/route";

const request = () =>
  new Request("https://example.test/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  m.constructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/stripe/webhook", () => {
  it("answers 200 when the event was processed (or was a duplicate)", async () => {
    m.handle.mockResolvedValueOnce({ duplicate: false, processed: true });
    expect((await POST(request())).status).toBe(200);
    m.handle.mockResolvedValueOnce({ duplicate: true, processed: true });
    expect((await POST(request())).status).toBe(200);
  });
  it("answers 500 when the event was stored but processing failed, so Stripe redelivers it", async () => {
    m.handle.mockResolvedValue({ duplicate: false, processed: false, error: "quote not found" });
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/retry/) });
  });
  it("answers 500 when the event could not be stored, 400 on a bad signature", async () => {
    m.handle.mockRejectedValue(new Error("db down"));
    expect((await POST(request())).status).toBe(500);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    m.constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    expect((await POST(request())).status).toBe(400);
  });
});
