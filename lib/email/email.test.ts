import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MessageKind } from "../db/types";
import { getEmailProvider, renderEmail, requiresOptIn, sendMessage, unsubscribeUrl } from "./index";

function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const updates: Array<{ table: string; id: unknown; patch: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      return {
        select: () => ({
          eq: (col: string, val: unknown) => ({
            maybeSingle: async () => ({ data: tables[table].find((r) => r[col] === val) ?? null, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (col: string, val: unknown) => {
            const row = tables[table].find((r) => r[col] === val);
            if (row) Object.assign(row, patch);
            updates.push({ table, id: val, patch });
            return { error: null };
          },
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, updates };
}

const customer = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Pat",
  email: "pat@example.com",
  phone: "+14405550100",
  email_opt_in: false,
  sms_opt_in: false,
  unsubscribe_token: "tok 123",
  ...over,
});
const message = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  customer_id: "c1",
  channel: "email",
  kind: "review",
  subject: "How did we do?",
  body: "Thanks!\n\nLeave a review?",
  status: "queued",
  ...over,
});

describe("render", () => {
  it("builds the unsubscribe url", () => {
    expect(unsubscribeUrl("https://x.test", "abc")).toBe("https://x.test/unsubscribe?token=abc");
    expect(unsubscribeUrl("https://x.test/", "abc")).toBe("https://x.test/unsubscribe?token=abc");
  });

  it("escapes HTML and includes unsubscribe + business header in both parts", () => {
    const { text, html } = renderEmail({
      subject: "Hi <b>",
      body: `Hello <script>alert("x")</script> & friends\nline two`,
      siteUrl: "https://x.test",
      token: "abc",
      business: "Emmett's <Lawns>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; friends<br>line two");
    expect(html).toContain("Emmett&#39;s &lt;Lawns&gt;");
    expect(html).toContain("https://x.test/unsubscribe?token=abc");
    expect(html).toContain('name="viewport"');
    expect(text).toContain("https://x.test/unsubscribe?token=abc");
    expect(text).toContain("Hello <script>"); // plain text is not escaped
  });

  it("signs off with where we work and the phone number", () => {
    const { text, html } = renderEmail({ subject: "s", body: "b", siteUrl: "https://x.test", token: "abc", business: "Emmett's" });
    expect(text).toContain("Emmett's · Northeast Ohio · (440) 823-5545");
    expect(html).toContain("Northeast Ohio · (440) 823-5545");
  });
});

describe("requiresOptIn", () => {
  it("is false for transactional kinds and true for marketing kinds", () => {
    const transactional: MessageKind[] = ["quote", "confirmation", "reminder", "referral", "decline"];
    for (const k of transactional) expect(requiresOptIn(k)).toBe(false);
    expect(requiresOptIn("review")).toBe(true);
    expect(requiresOptIn("snow")).toBe(true);
    expect(requiresOptIn("custom")).toBe(true);
  });
});

describe("getEmailProvider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("smtp throws the TODO error", () => {
    process.env.EMAIL_PROVIDER = "smtp";
    expect(() => getEmailProvider()).toThrow("TODO [EMAIL PROVIDER]: smtp not configured");
  });

  it("real providers require EMAIL_FROM", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "k";
    delete process.env.EMAIL_FROM;
    await expect(getEmailProvider().send({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow(/EMAIL_FROM/);
  });

  it("resend posts to the Resend API with the bearer key", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "rk";
    process.env.EMAIL_FROM = "Emmett <hi@x.test>";
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      const r = await getEmailProvider().send({ to: "a@b.c", subject: "s", text: "t", html: "<p>t</p>" });
      expect(r.id).toBe("re_1");
      const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer rk");
      expect(JSON.parse(init.body as string)).toMatchObject({ from: "Emmett <hi@x.test>", to: ["a@b.c"] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("postmark posts to the Postmark API with the server token", async () => {
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "pt";
    process.env.EMAIL_FROM = "hi@x.test";
    const f = vi.fn(async () => new Response(JSON.stringify({ MessageID: "pm_1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      const r = await getEmailProvider().send({ to: "a@b.c", subject: "s", text: "t" });
      expect(r.id).toBe("pm_1");
      const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.postmarkapp.com/email");
      expect((init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("pt");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sendMessage", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = "log";
    process.env.SMS_PROVIDER = "log";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });
  const opts = { siteUrl: "https://x.test" };

  it("cancels marketing email when not opted in", async () => {
    const { db, updates } = fakeDb({ messages: [message()], customers: [customer()] });
    const r = await sendMessage(db, "m1", opts);
    expect(r.status).toBe("cancelled");
    expect(updates[0].patch).toMatchObject({ status: "cancelled" });
    expect(String(updates[0].patch.error)).toMatch(/opted in/);
  });

  it("cancels email when the customer has no email", async () => {
    const { db, updates } = fakeDb({
      messages: [message({ kind: "quote" })],
      customers: [customer({ email: null, email_opt_in: true })],
    });
    expect((await sendMessage(db, "m1", opts)).status).toBe("cancelled");
    expect(updates[0].patch.status).toBe("cancelled");
  });

  it("cancels sms when not sms_opt_in, even for transactional kinds", async () => {
    const { db } = fakeDb({
      messages: [message({ channel: "sms", kind: "reminder" })],
      customers: [customer({ email_opt_in: true })],
    });
    expect((await sendMessage(db, "m1", opts)).status).toBe("cancelled");
  });

  it("sends transactional email without opt-in", async () => {
    const { db, updates } = fakeDb({ messages: [message({ kind: "quote" })], customers: [customer()] });
    const r = await sendMessage(db, "m1", opts);
    expect(r).toEqual({ status: "sent", providerId: null });
    expect(updates[0].patch).toMatchObject({ status: "sent", provider_id: null });
    expect(typeof updates[0].patch.sent_at).toBe("string");
  });

  it("sends opted-in sms via the log provider", async () => {
    const { db, updates } = fakeDb({
      messages: [message({ channel: "sms", kind: "reminder", body: "See you tomorrow" })],
      customers: [customer({ sms_opt_in: true })],
    });
    expect((await sendMessage(db, "m1", opts)).status).toBe("sent");
    expect(updates[0].patch.status).toBe("sent");
  });

  it("marks failed when the provider throws", async () => {
    process.env.EMAIL_PROVIDER = "smtp";
    const { db, updates } = fakeDb({
      messages: [message({ kind: "quote" })],
      customers: [customer()],
    });
    const r = await sendMessage(db, "m1", opts);
    expect(r.status).toBe("failed");
    expect(updates[0].patch).toMatchObject({ status: "failed" });
    expect(String(updates[0].patch.error)).toMatch(/smtp not configured/);
  });
});
