/**
 * processQuote: every press of Send is kept (quote_submissions) and ends as saved / rejected /
 * failed, and the browser's retry of a saved request never makes a second lead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./ops/test-utils";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: () => new Headers({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250)}` }),
  cookies: () => ({ get: () => undefined }),
}));
vi.mock("@/lib/canvass/hanger-events", () => ({ recordHangerBooking: async () => undefined }));

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => state.db }));

const { processQuote } = await import("./quote-submit");

const SID = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";

function form(over: Record<string, string | string[]> = {}): FormData {
  const fields: Record<string, string | string[]> = {
    name: "Dana Customer",
    email: "dana@example.com",
    phone: "(440) 555-0123",
    street: "123 Main St",
    city: "Bay Village",
    state: "OH",
    zip: "44140",
    services: ["fall-cleanup"],
    customRequest: "",
    _sid: SID,
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

let db: FakeDb;
beforeEach(() => {
  db = fakeDb({ services: [{ id: "svc-fall", slug: "fall-cleanup", active: true, name: "Fall cleanup" }] });
  state.db = db;
});

describe("processQuote", () => {
  it("saves the raw submission, then the lead, and links them", async () => {
    const r = await processQuote(form(), "action");
    expect(r).toEqual({ status: "ok" });
    expect(db.tables.leads).toHaveLength(1);
    const [sub] = db.tables.quote_submissions;
    expect(sub).toMatchObject({
      outcome: "saved",
      via: "action",
      client_key: SID,
      name: "Dana Customer",
      phone: "(440) 555-0123",
      address: "123 Main St, Bay Village, OH 44140",
      lead_id: db.tables.leads[0].id,
    });
    expect(db.rpcCalls.some((c) => c.fn === "enqueue_task")).toBe(true);
  });

  it("keeps what they typed when the form turns it away", async () => {
    const r = await processQuote(form({ phone: "555" }), "action");
    expect(r.status).toBe("error");
    expect(db.tables.leads ?? []).toHaveLength(0);
    const [sub] = db.tables.quote_submissions;
    expect(sub.outcome).toBe("rejected");
    expect(sub.reason).toMatch(/phone/);
    expect(sub.name).toBe("Dana Customer");
  });

  it("records a server failure with what they typed", async () => {
    const insert = db.from.bind(db);
    db.from = ((t: string) => {
      const q = insert(t as never);
      if (t === "leads") (q as { insert: unknown }).insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }) });
      return q;
    }) as typeof db.from;
    const r = await processQuote(form(), "action");
    expect(r.status).toBe("error");
    const [sub] = db.tables.quote_submissions;
    expect(sub.outcome).toBe("failed");
    expect(sub.reason).toMatch(/boom/);
    expect(sub.email).toBe("dana@example.com");
  });

  it("a retry of a request that was already saved doesn't make a second lead", async () => {
    expect(await processQuote(form(), "action")).toEqual({ status: "ok" });
    expect(await processQuote(form(), "api")).toEqual({ status: "ok" });
    expect(db.tables.leads).toHaveLength(1);
    expect(db.tables.quote_submissions).toHaveLength(1);
  });

  it("a retry after a failed first try reuses the row and saves the lead", async () => {
    await processQuote(form({ phone: "555" }), "action");
    expect(await processQuote(form(), "api")).toEqual({ status: "ok" });
    expect(db.tables.quote_submissions).toHaveLength(1);
    expect(db.tables.quote_submissions[0]).toMatchObject({ outcome: "saved", via: "api" });
    expect(db.tables.leads).toHaveLength(1);
  });

  it("bots (honeypot) are dropped without saving anything", async () => {
    expect(await processQuote(form({ company: "Acme" }), "action")).toEqual({ status: "ok" });
    expect(db.tables.quote_submissions ?? []).toHaveLength(0);
    expect(db.tables.leads ?? []).toHaveLength(0);
  });
});
