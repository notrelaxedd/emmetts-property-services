import { describe, expect, it } from "vitest";
import { assembleParcelViews, knockSummary, nearCustomerFor } from "./assemble";
import { blockGroupRow, canvassSettingsRow, knockRow, parcelRow } from "./rows.fixture";
import { seasonFocus } from "./season";

const settings = canvassSettingsRow();
const season = seasonFocus(10, settings.season_map); // October → leaf cleanup
const GEOID = "390351621021";
const bg = blockGroupRow({ geoid: GEOID });
const blockGroups = new Map([[GEOID, bg]]);
const names = new Map([["knocker-a", "Emmett"]]);

const base = () => ({ blockGroups, knockerNames: names, customers: [], settings, season });

describe("near customer", () => {
  it("ignores the parcel's own customer row but counts a neighbour", () => {
    const p = parcelRow({ customer_id: "c-self", parcel_id: "PIN-1", address: "19000 DETROIT RD" });
    const self = { id: "c-self", address: "19000 Detroit Rd", lat: p.centroid_lat, lng: p.centroid_lng, parcel_id: "PIN-1" };
    expect(nearCustomerFor(p, [self], settings)).toBe("none");
    const neighbour = { id: "c-2", address: "19004 Detroit Rd", lat: null, lng: null, parcel_id: null };
    expect(nearCustomerFor(p, [self, neighbour], settings)).toBe("adjacent");
    expect(nearCustomerFor(p, [self, neighbour], { neighbor_n: 1 })).toBe("street");
  });
});

describe("assembleParcelViews", () => {
  it("resolves the simple score, quotes, last knock and customer flag", () => {
    const a = parcelRow({ block_group_geoid: GEOID, lot_sqft: 8276.4, living_sqft: 1624, stories: 1.5, address: "19000 DETROIT RD" });
    const b = parcelRow({ block_group_geoid: GEOID, callback_window: "weekdays after 5", address: "19004 DETROIT RD", parcel_id: "PIN-B" });
    const c = parcelRow({ block_group_geoid: null, do_not_knock: true, do_not_knock_reason: "sign", address: "19008 DETROIT RD" });
    const d = parcelRow({ block_group_geoid: GEOID, lot_sqft: null, living_sqft: null, address: "19012 DETROIT RD", customer_id: "cust-d", owner_display: "SMITH, MARIA" });
    const knocks = [
      knockRow({ parcel_id: a.id, knocked_at: "2026-10-20T21:00:00.000Z", outcome: "no_answer" }),
      knockRow({ parcel_id: a.id, knocked_at: "2026-10-28T21:00:00.000Z", outcome: "call_back" }),
    ];
    const customers = [{ id: "cust-x", address: "19002 Detroit Rd", lat: null, lng: null, parcel_id: "PIN-B" }];
    const views = assembleParcelViews({ ...base(), parcels: [a, b, c, d], knocks, customers });
    const [va, vb, vc, vd] = views;

    // a: the estimate is recomputed from settings (lot − footprint − 12%).
    expect(va.fullAddress).toBe("19000 Detroit Rd, Rocky River, OH 44116");
    expect(va.ownerFirstName).toBe("John");
    expect(va.turf_sqft_est).toBe(Math.round(8276.4 - 1624 / 1.5 - 8276.4 * 0.12));
    expect(va.turfSource).toBe("estimate");
    expect(va.quote).toEqual(va.quotes.leaf_cleanup);
    // ~6,200 sqft of turf is a medium lot: leaf cleanup $40 from the default price tiers.
    expect(va.quote).toMatchObject({ service: "leaf_cleanup", tier: "medium", status: "priced", price: 40, label: "$40" });
    expect(va.lastKnock).toEqual({ knocked_at: "2026-10-28T21:00:00.000Z", outcome: "call_back", knocker_name: "Emmett" });
    expect(va.knockCount).toBe(2);
    expect(va.isCustomer).toBe(false);
    // Medium lot 2 + adjacent customer (19002) 3 + owner-occupied 3.
    expect(va.simple.breakdown).toEqual({ lawn: 2, customer: 3, owner: 3 });
    expect(va.simple.points).toBe(8);
    expect(va.simple.label).toBe("hot");
    expect(va.medianIncome).toBe(85000);
    for (const gone of ["window", "knock", "plain", "strip"]) expect(gone in va).toBe(false);
    expect("score" in va).toBe(false);
    expect("quintile" in va).toBe(false);

    // b: the homeowner's words stay on the parcel; it is a customer by county PIN, so its own customer row does not count for it.
    expect(vb.callback_window).toBe("weekdays after 5");
    expect(vb.isCustomer).toBe(true);
    expect(vb.simple.breakdown.customer).toBe(0);

    // c: do not knock → nothing scores.
    expect(vc.simple.points).toBe(0);
    expect(vc.simple.label).toBe("low");
    expect(vc.simple.reasons).toEqual([]);

    // d: unknown lot → "Lot size unknown", no price; customer_id set; "SMITH, MARIA" greets as Maria.
    expect(vd.turf_sqft_est).toBeNull();
    expect(vd.turfSource).toBeNull();
    expect(vd.quote).toMatchObject({ tier: null, status: "unknown_turf", price: null, label: "Lot size unknown" });
    expect(vd.isCustomer).toBe(true);
    expect(vd.ownerFirstName).toBe("Maria");
    expect(vd.simple.breakdown.lawn).toBe(1);
  });

  it("knockSummary keeps the latest knock and the count", () => {
    const s = knockSummary([
      knockRow({ parcel_id: "x", knocked_at: "2026-10-01T12:00:00Z", outcome: "booked" }),
      knockRow({ parcel_id: "x", knocked_at: "2026-10-05T12:00:00Z", outcome: "no_answer" }),
      knockRow({ parcel_id: "x", knocked_at: "2026-10-03T12:00:00Z", outcome: "call_back" }),
    ]);
    expect(s.get("x")?.count).toBe(3);
    expect(s.get("x")?.last.outcome).toBe("no_answer");
  });
});
