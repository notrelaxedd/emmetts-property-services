import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Db } from "../ops/types";
import { settingsRow } from "../ops/test-utils";
import { canvassSettingsRow, parcelRow } from "./rows.fixture";
import { createDoorLeadAndQuote, defaultDoorPrice, doorAmounts, doorCustomerName, findDoorCustomer, repriceDoorQuote, type DoorParcel } from "./door-booking";

/**
 * A tiny chainable supabase-js stand-in: from(t).select()/insert()/update() with eq / in / ilike /
 * order / limit / single / maybeSingle, returning canned rows from in-memory tables.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

function smallDb(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = v.map((r) => ({ ...r }));
  const table = (t: string) => (tables[t] ??= []);

  class Q implements PromiseLike<Result> {
    private filters: ((r: Row) => boolean)[] = [];
    private mode: "select" | "insert" | "update" = "select";
    private payload: unknown;
    private returning = false;
    private shape: "single" | "maybe" | null = null;
    private max: number | null = null;
    private orderBy: { col: string; asc: boolean } | null = null;
    constructor(private t: string) {}
    select() {
      if (this.mode !== "select") this.returning = true;
      return this;
    }
    insert(rows: unknown) {
      this.mode = "insert";
      this.payload = rows;
      return this;
    }
    update(patch: unknown) {
      this.mode = "update";
      this.payload = patch;
      return this;
    }
    eq(col: string, v: unknown) {
      this.filters.push((r) => r[col] === v);
      return this;
    }
    in(col: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[col]));
      return this;
    }
    ilike(col: string, pattern: string) {
      const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
      this.filters.push((r) => typeof r[col] === "string" && re.test(r[col] as string));
      return this;
    }
    order(col: string, o?: { ascending?: boolean }) {
      this.orderBy = { col, asc: o?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    single() {
      this.shape = "single";
      return this;
    }
    maybeSingle() {
      this.shape = "maybe";
      return this;
    }
    private run(): Result {
      const rows = table(this.t);
      let hit: Row[];
      if (this.mode === "insert") {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const now = new Date().toISOString();
        hit = incoming.map((r) => ({ id: randomUUID(), created_at: now, updated_at: now, ...r }));
        rows.push(...hit);
        if (!this.returning) return { data: null, error: null };
      } else {
        hit = rows.filter((r) => this.filters.every((f) => f(r)));
        if (this.mode === "update") {
          for (const r of hit) Object.assign(r, this.payload as Row);
          if (!this.returning) return { data: null, error: null };
        }
      }
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        hit = [...hit].sort((a, b) => ((a[col] as string) < (b[col] as string) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (this.max !== null) hit = hit.slice(0, this.max);
      const out = JSON.parse(JSON.stringify(hit)) as Row[];
      if (this.shape === "single") {
        if (out.length !== 1) return { data: null, error: { code: "PGRST116", message: `expected 1 row, got ${out.length}` } };
        return { data: out[0], error: null };
      }
      if (this.shape === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
    then<A = Result, B = never>(
      onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null,
      onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
    }
  }

  const db = { from: (t: string) => new Q(t), rpc: async () => ({ data: null, error: null }), tables };
  return db as unknown as Db & { tables: Record<string, Row[]> };
}

const parcel = (over: Partial<DoorParcel> = {}): DoorParcel => ({
  id: "parcel-1",
  parcel_id: "301-22-045",
  address: "19000 DETROIT RD",
  street: "DETROIT RD",
  owner_display: "SMITH JOHN",
  centroid_lat: 41.47,
  centroid_lng: -81.84,
  lot_sqft: 8_712,
  customer_id: null,
  ...over,
});

const base = () => ({ settings: [settingsRow({ default_wage: 20, margin: 0.5, quote_valid_days: 14 }) as unknown as Row] });

describe("doorCustomerName", () => {
  it("uses the owner name, else a Resident placeholder", () => {
    expect(doorCustomerName({ owner_display: "SMITH JOHN", address: "1 MAIN ST" })).toBe("SMITH JOHN");
    expect(doorCustomerName({ owner_display: "  ", address: "1 MAIN ST" })).toBe("Resident, 1 MAIN ST");
    expect(doorCustomerName({ owner_display: null, address: "1 MAIN ST" })).toBe("Resident, 1 MAIN ST");
  });
});

describe("doorAmounts / defaultDoorPrice", () => {
  it("typed amounts win; else the tier price for both ends; else unpriced 0", () => {
    expect(doorAmounts({ amount_low: 45, amount_high: 60, default_price: 40 })).toEqual({ low: 45, high: 60, price: 52.5, priced: true });
    expect(doorAmounts({ amount_low: 55, default_price: 40 })).toEqual({ low: 55, high: 55, price: 55, priced: true });
    expect(doorAmounts({ amount_low: null, amount_high: null, default_price: 40 })).toEqual({ low: 40, high: 40, price: 40, priced: true });
    expect(doorAmounts({ default_price: null })).toEqual({ low: 0, high: 0, price: 0, priced: false });
    expect(doorAmounts({})).toMatchObject({ price: 0, priced: false });
  });
  it("the default price is the featured service's tier price when priced, else null", () => {
    const settings = canvassSettingsRow();
    // 8,276 sqft lot, 1,624 sqft living on 1.5 stories, 12% hardscape: ~6,200 sqft of turf → medium → $40 leaf cleanup.
    const medium = parcelRow({ lot_sqft: 8276.4, living_sqft: 1624, stories: 1.5, footprint_sqft: null, turf_sqft_traced: null });
    expect(defaultDoorPrice(medium, settings, "leaf_cleanup")).toBe(40);
    // Mowing has no prices filled in yet.
    expect(defaultDoorPrice(medium, settings, "mow")).toBeNull();
    // A traced lawn changes the tier (3,000 sqft is small: $30); an unknown lot has no price.
    expect(defaultDoorPrice({ ...medium, turf_sqft_traced: 3000 }, settings, "leaf_cleanup")).toBe(30);
    expect(defaultDoorPrice(parcelRow({ lot_sqft: null, living_sqft: null }), settings, "leaf_cleanup")).toBeNull();
    // Editing the tiers changes it.
    expect(defaultDoorPrice(medium, canvassSettingsRow({ price_tiers: { ...settings.price_tiers, leaf_cleanup: { small: 30, medium: 55, large: 50, xl: null } } }), "leaf_cleanup")).toBe(55);
  });
});

describe("createDoorLeadAndQuote", () => {
  it("uses the house's tier price when no amount was typed (quote_given and booked)", async () => {
    const db = smallDb({ ...base(), customers: [], parcels: [{ id: "parcel-1", customer_id: null }] });
    const res = await createDoorLeadAndQuote(db, { parcel: parcel(), knocker_name: "Sam", outcome: "booked", default_price: 40, service: "leaf_cleanup" });
    const quote = db.tables.quotes.find((q) => q.id === res.quote_id)!;
    expect(quote.price_total).toBe(40);
    expect(quote.rationale).toBe("Door quote by Sam: $40 for Leaf cleanup.");
    expect(db.tables.quote_items[0].price).toBe(40);
    expect(await repriceDoorQuote(db, res.quote_id, 55, 55)).toBe(true);
    expect(db.tables.quotes[0].rationale).toBe("Door quote by Sam: $55 for Leaf cleanup.");
  });

  it("books at 0 with a 'price to be set' note when the tier is not priced and nothing was typed", async () => {
    const db = smallDb({ ...base(), customers: [], parcels: [{ id: "parcel-1", customer_id: null }] });
    const res = await createDoorLeadAndQuote(db, { parcel: parcel(), knocker_name: "Sam", outcome: "quote_given", amount_low: null, amount_high: null, default_price: null, service: "mow" });
    const quote = db.tables.quotes[0];
    expect(quote.price_total).toBe(0);
    expect(quote.rationale).toContain("price to be set");
    expect(await repriceDoorQuote(db, res.quote_id, 70, 70)).toBe(true);
    expect(db.tables.quotes[0].rationale).toBe("Door quote by Sam for Mowing: $70.");
  });

  it("reuses the customer linked on the parcel and sends a quote for quote_given", async () => {
    const existing = { id: "cust-1", name: "Jane", address: "19000 Detroit Rd, Rocky River", parcel_id: null, created_at: "2026-01-01" };
    const db = smallDb({ ...base(), customers: [existing], parcels: [{ id: "parcel-1", customer_id: "cust-1" }] });
    const res = await createDoorLeadAndQuote(db, {
      parcel: parcel({ customer_id: "cust-1" }),
      knocker_name: "Sam",
      outcome: "quote_given",
      amount_low: 40,
      amount_high: 60,
      service: "leaf_cleanup",
    });
    expect(res.customer_id).toBe("cust-1");
    expect(db.tables.customers).toHaveLength(1);
    const lead = db.tables.leads[0];
    expect(lead.status).toBe("quoted");
    expect(lead.source).toBe("canvass");
    expect(lead.utm).toEqual({ source: "canvass", medium: "door", campaign: "DETROIT RD" });
    const quote = db.tables.quotes[0];
    expect(quote.id).toBe(res.quote_id);
    expect(quote.status).toBe("sent");
    expect(quote.sent_at).toBeTruthy();
    expect(quote.accepted_at).toBeNull();
    expect(quote.price_total).toBe(50);
    expect(quote.wage).toBe(20);
    expect(quote.margin).toBe(0.5);
    const item = db.tables.quote_items[0];
    expect(item.is_custom).toBe(true);
    expect(item.description).toBe("Door quote: Leaf cleanup");
    expect(item.status).toBe("priced");
    expect(item.price).toBe(50);
    expect(res.job_id).toBeNull();
    expect(db.tables.jobs ?? []).toHaveLength(0);
  });

  it("creates a customer when none matches, books the job and links the parcel", async () => {
    const db = smallDb({ ...base(), customers: [], parcels: [{ id: "parcel-1", customer_id: null }] });
    const res = await createDoorLeadAndQuote(db, {
      parcel: parcel(),
      knocker_name: "Sam",
      outcome: "booked",
      amount_low: 100,
      amount_high: 150,
      service: "mow",
    });
    const customer = db.tables.customers[0];
    expect(customer.id).toBe(res.customer_id);
    expect(customer.name).toBe("SMITH JOHN");
    expect(customer.address).toBe("19000 DETROIT RD");
    expect(customer.parcel_id).toBe("301-22-045");
    expect(customer.lat).toBe(41.47);
    expect(customer.lot_acres).toBe(0.2);
    expect(db.tables.leads[0].status).toBe("won");
    const quote = db.tables.quotes[0];
    expect(quote.status).toBe("accepted");
    expect(quote.accepted_at).toBeTruthy();
    expect(quote.sent_at).toBeTruthy();
    expect(quote.price_total).toBe(125);
    const job = db.tables.jobs[0];
    expect(job.id).toBe(res.job_id);
    expect(job.status).toBe("unscheduled");
    expect(job.quote_id).toBe(res.quote_id);
    expect(job.customer_id).toBe(res.customer_id);
    expect(job.paid).toBe(false);
    expect(job.est_minutes).toBe(60);
    expect(db.tables.parcels[0].customer_id).toBe(res.customer_id);
  });

  it("matches an existing customer by county PIN, then by normalised address", async () => {
    const byPin = { id: "c-pin", name: "Pin", address: null, parcel_id: "301-22-045", created_at: "2026-01-01" };
    expect((await findDoorCustomer(smallDb({ customers: [byPin] }), parcel()))?.id).toBe("c-pin");

    const byAddress = { id: "c-addr", name: "Addr", address: "19000 Detroit Rd., Rocky River OH", parcel_id: null, created_at: "2026-01-01" };
    const other = { id: "c-other", name: "Other", address: "19002 Detroit Rd", parcel_id: null, created_at: "2026-01-01" };
    expect((await findDoorCustomer(smallDb({ customers: [other, byAddress] }), parcel()))?.id).toBe("c-addr");
    expect(await findDoorCustomer(smallDb({ customers: [other] }), parcel())).toBeNull();
  });

  it("uses the Resident placeholder name when the county has no owner", async () => {
    const db = smallDb({ ...base(), customers: [], parcels: [{ id: "parcel-1", customer_id: null }] });
    await createDoorLeadAndQuote(db, {
      parcel: parcel({ owner_display: null }),
      knocker_name: "Sam",
      outcome: "quote_given",
      amount_low: 40,
      amount_high: 40,
      service: "snow",
    });
    expect(db.tables.customers[0].name).toBe("Resident, 19000 DETROIT RD");
  });
});

describe("repriceDoorQuote", () => {
  it("re-prices the door quote, its line and rationale with the amounts typed after the tap", async () => {
    const db = smallDb({ ...base(), customers: [], parcels: [{ id: "parcel-1", customer_id: null }] });
    const res = await createDoorLeadAndQuote(db, { parcel: parcel(), knocker_name: "Sam", outcome: "booked", amount_low: 45, amount_high: 60, service: "mow" });
    expect(db.tables.quotes[0].price_total).toBe(52.5);
    expect(await repriceDoorQuote(db, res.quote_id, 120, 120)).toBe(true);
    const quote = db.tables.quotes[0];
    expect(quote.price_total).toBe(120);
    expect(quote.profit_total).toBe(120 - (quote.labor_total as number));
    expect(quote.rationale).toContain("for Mowing."); // "$120" replaced the typed range
    expect(quote.rationale).toContain("$120");
    expect(quote.rationale).not.toContain("$120–");
    expect(db.tables.quote_items[0].price).toBe(120);
  });
  it("leaves a paid or declined quote alone", async () => {
    const db = smallDb({ quotes: [{ id: "q1", status: "declined", labor_total: 20, paid_at: null, price_total: 50, rationale: "" }] });
    expect(await repriceDoorQuote(db, "q1", 100, 100)).toBe(false);
    expect(db.tables.quotes[0].price_total).toBe(50);
    expect(await repriceDoorQuote(db, "missing", 100, 100)).toBe(false);
  });
});
