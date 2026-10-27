/** Owner edits on the customer page: which fields get written, how they are normalised, and the map pin. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customerRow, fakeDb, type FakeDb } from "@/lib/ops/test-utils";

const m = vi.hoisted(() => ({ db: null as unknown, geocode: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOwner: async () => ({ userId: "owner" }) }));
vi.mock("@/lib/supabase/admin", () => ({ requireSupabaseAdmin: () => m.db }));
vi.mock("@/lib/geo", () => ({ geocode: m.geocode }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { updateCustomer } from "./customers";

let db: FakeDb;
let id: string;
const customer = () => db.tables.customers[0];

beforeEach(() => {
  vi.clearAllMocks();
  m.geocode.mockResolvedValue(null);
  const row = customerRow({
    name: "Old Name",
    email: "old@example.com",
    phone: "4405550100",
    address: "1 Old Rd, Rocky River, OH 44116",
    lat: 41.4,
    lng: -81.8,
    parcel_id: "301-01-001",
    notes: "Gate code 1234",
    email_opt_in: true,
  });
  id = row.id;
  db = fakeDb({ customers: [row] });
  m.db = db;
});

describe("updateCustomer", () => {
  it("saves the contact card, storing email and phone the way the quote form does", async () => {
    const r = await updateCustomer(id, {
      name: "  New Name ",
      email: " New@Example.COM ",
      phone: "(440) 555-0199",
      address: " 2 New St, Bay Village, OH 44140 ",
      parcel_id: " 302-02-002 ",
    });
    expect(r).toEqual({ ok: true, message: "Customer saved." });
    expect(customer()).toMatchObject({
      name: "New Name",
      email: "new@example.com",
      phone: "4405550199",
      address: "2 New St, Bay Village, OH 44140",
      parcel_id: "302-02-002",
      // The preferences card's fields are not touched.
      notes: "Gate code 1234",
      email_opt_in: true,
    });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/admin/customers/${id}`);
  });

  it("clears the map pin when the address changes and no geocoder answers", async () => {
    await updateCustomer(id, { address: "2 New St, Bay Village, OH 44140" });
    expect(customer()).toMatchObject({ address: "2 New St, Bay Village, OH 44140", lat: null, lng: null });
    expect(m.geocode).toHaveBeenCalledWith("2 New St, Bay Village, OH 44140");
  });

  it("moves the map pin to the geocoded address", async () => {
    m.geocode.mockResolvedValue({ lat: 41.5, lng: -81.9, formatted: "2 New St, Bay Village, OH 44140" });
    await updateCustomer(id, { address: "2 New St, Bay Village, OH 44140" });
    expect(customer()).toMatchObject({ lat: 41.5, lng: -81.9 });
  });

  it("keeps the map pin when the address is unchanged, even if the geocoder would fail", async () => {
    m.geocode.mockRejectedValue(new Error("down"));
    const r = await updateCustomer(id, { name: "Renamed", address: "1 Old Rd, Rocky River, OH 44116" });
    expect(r.ok).toBe(true);
    expect(customer()).toMatchObject({ name: "Renamed", lat: 41.4, lng: -81.8 });
    expect(m.geocode).not.toHaveBeenCalled();
  });

  it("clears emptied fields, and the pin with the address", async () => {
    const r = await updateCustomer(id, { email: "", phone: "", address: "   ", parcel_id: "" });
    expect(r.ok).toBe(true);
    expect(customer()).toMatchObject({ email: null, phone: null, address: null, parcel_id: null, lat: null, lng: null });
    expect(m.geocode).not.toHaveBeenCalled();
  });

  it("writes only the fields it was sent, so the preferences card never overwrites the contact card", async () => {
    const r = await updateCustomer(id, { notes: "  Dog in yard  ", email_opt_in: false, lot_acres: 0.3, tree_cover: "heavy" });
    expect(r.ok).toBe(true);
    expect(customer()).toMatchObject({
      notes: "Dog in yard",
      email_opt_in: false,
      lot_acres: 0.3,
      tree_cover: "heavy",
      name: "Old Name",
      email: "old@example.com",
      phone: "4405550100",
      lat: 41.4,
    });
  });

  it("rejects a bad phone, a bad email and an empty name, changing nothing", async () => {
    expect(await updateCustomer(id, { phone: "555-0100" })).toEqual({ ok: false, reason: "Enter a 10-digit phone number." });
    expect(await updateCustomer(id, { email: "not an email" })).toEqual({ ok: false, reason: "That email doesn't look right." });
    expect(await updateCustomer(id, { name: "   " })).toEqual({ ok: false, reason: "Name is required." });
    expect(customer()).toMatchObject({ name: "Old Name", email: "old@example.com", phone: "4405550100" });
  });

  it("reports an unknown customer, a bad id and an empty patch", async () => {
    expect(await updateCustomer("00000000-0000-4000-8000-000000000000", { name: "X" })).toEqual({ ok: false, reason: "Customer not found." });
    expect(await updateCustomer("nope", { name: "X" })).toEqual({ ok: false, reason: "Invalid customer." });
    expect(await updateCustomer(id, {})).toEqual({ ok: true, message: "Nothing to save." });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});
