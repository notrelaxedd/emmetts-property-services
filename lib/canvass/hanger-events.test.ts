import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../ops/test-utils";
import { activeHangerCode, recordHangerBooking, recordHangerScan } from "./hanger-events";

const codes = [
  { id: "hc-1", code: "K7M2", street: "DETROIT RD", block_group_geoid: null, active: true },
  { id: "hc-2", code: "XQ9P", street: "ELM ST", block_group_geoid: null, active: false },
];

afterEach(() => vi.restoreAllMocks());

describe("recordHangerScan", () => {
  it("writes a scan for an active code and nothing for inactive / unknown / malformed codes", async () => {
    const db = fakeDb({ hanger_codes: codes });
    expect(await recordHangerScan(db, "k7m2", "abc123")).toBe(true);
    expect(await recordHangerScan(db, "XQ9P", "abc123")).toBe(false);
    expect(await recordHangerScan(db, "ZZZZ", "abc123")).toBe(false);
    expect(await recordHangerScan(db, "no", "abc123")).toBe(false);
    expect(db.tables.hanger_events).toEqual([expect.objectContaining({ code: "K7M2", event: "scan", visitor: "abc123", lead_id: null })]);
  });
  it("skips the lookup when the caller verified the code", async () => {
    const db = fakeDb({ hanger_codes: codes });
    expect(await recordHangerScan(db, "K7M2", null, { verified: true })).toBe(true);
    expect(db.tables.hanger_events[0].visitor).toBeNull();
  });
  it("never throws when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) } as never;
    expect(await activeHangerCode(db, "K7M2")).toBeNull();
    expect(await recordHangerScan(db, "K7M2", "v")).toBe(false);
  });
});

describe("recordHangerBooking", () => {
  it("credits the QR tags first, then the cookie, and ignores unrelated leads", async () => {
    const db = fakeDb({ hanger_codes: codes });
    expect(await recordHangerBooking(db, { utm: { source: "hanger", campaign: "K7M2" }, cookie: "XQ9P", leadId: "lead-1" })).toBe("K7M2");
    expect(await recordHangerBooking(db, { utm: { source: "flyer", campaign: "ABCD" }, cookie: "xq9p", leadId: "lead-2" })).toBe("XQ9P");
    expect(await recordHangerBooking(db, { utm: {}, cookie: null, leadId: "lead-3" })).toBeNull();
    expect(await recordHangerBooking(db, { utm: { source: "hanger", campaign: "NOPE" }, cookie: null, leadId: "lead-4" })).toBeNull();
    expect(db.tables.hanger_events.map((e) => [e.code, e.event, e.lead_id])).toEqual([
      ["K7M2", "booking", "lead-1"],
      ["XQ9P", "booking", "lead-2"], // bookings count even for a deactivated code
    ]);
  });
  it("never throws when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) } as never;
    expect(await recordHangerBooking(db, { utm: { source: "hanger", campaign: "K7M2" }, cookie: null, leadId: "lead-1" })).toBeNull();
  });
});
