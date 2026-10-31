import { describe, expect, it } from "vitest";
import { assembleParcelViews, knockSummary, learnedGroupKey, learnedWindowsFor, nearCustomerFor } from "./assemble";
import { blockGroupRow, canvassSettingsRow, knockRow, parcelRow } from "./rows.fixture";
import { seasonFocus } from "./season";

const settings = canvassSettingsRow();
const season = seasonFocus(10, settings.season_map); // October → leaf cleanup
const GEOID = "390351621021";
const bg = blockGroupRow({ geoid: GEOID });
const blockGroups = new Map([[GEOID, bg]]);
const names = new Map([["knocker-a", "Emmett"]]);

/** Thu 2026-10-29 5:15pm in Ohio (EDT): inside the block group's weekdays 4-6pm prior. */
const NOW = new Date("2026-10-29T21:15:00.000Z");
const base = () => ({ blockGroups, knockerNames: names, customers: [], settings, season, now: NOW });

describe("learned grouping", () => {
  it("pools by block group, else by street", () => {
    expect(learnedGroupKey(parcelRow({ block_group_geoid: GEOID }))).toBe(`bg:${GEOID}`);
    expect(learnedGroupKey(parcelRow({ block_group_geoid: null, street: "Elm St" }))).toBe("street:ELM ST");
  });
  it("learnedWindowsFor returns null below learned_min_knocks and a window above it", () => {
    const a = parcelRow({ block_group_geoid: GEOID });
    const b = parcelRow({ block_group_geoid: GEOID });
    const few = [knockRow({ parcel_id: a.id }), knockRow({ parcel_id: b.id, outcome: "booked" })];
    expect(learnedWindowsFor([a, b], few, blockGroups, settings).get(`bg:${GEOID}`)).toBeNull();
    const many = Array.from({ length: 10 }, (_, i) =>
      knockRow({ parcel_id: i % 2 ? a.id : b.id, outcome: i < 9 ? "not_interested" : "no_answer", knocked_at: "2026-10-29T22:30:00.000Z" }),
    );
    const learned = learnedWindowsFor([a, b], many, blockGroups, settings).get(`bg:${GEOID}`);
    expect(learned?.knocks).toBe(10);
    // Thu 6:30pm Ohio → the weekdays 18–20 bucket answered 9 of 10: (1 + 9) / (1 + 3 + 10) beats the prior's 4 / 6.
    expect(learned?.best.start).toBe(18);
    expect(learned?.best.mean).toBeCloseTo(10 / 14, 10);
  });
});

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
  it("resolves window, light, plain text, simple score, quotes, last knock and customer flag", () => {
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

    // a: ACS prior window from the block group; the estimate is recomputed from settings (lot − footprint − 12%).
    expect(va.fullAddress).toBe("19000 Detroit Rd, Rocky River, OH 44116");
    expect(va.ownerFirstName).toBe("John");
    expect(va.window.source).toBe("acs");
    expect(va.window.label).toBe("Weekdays 4–6pm likely");
    expect(va.turf_sqft_est).toBe(Math.round(8276.4 - 1624 / 1.5 - 8276.4 * 0.12));
    expect(va.turfSource).toBe("estimate");
    expect(va.quote).toEqual(va.quotes.leaf_cleanup);
    // ~6,200 sqft of turf is a medium lot: leaf cleanup $40 from the default price tiers.
    expect(va.quote).toMatchObject({ service: "leaf_cleanup", tier: "medium", status: "priced", price: 40, label: "$40" });
    expect(va.lastKnock).toEqual({ knocked_at: "2026-10-28T21:00:00.000Z", outcome: "call_back", knocker_name: "Emmett" });
    expect(va.knockCount).toBe(2);
    expect(va.isCustomer).toBe(false);
    // Thu 5:15pm is inside weekdays 4-6pm: green. Medium lot 2 + adjacent customer (19002) 3 + green 3 + owner-occupied 3.
    expect(va.knock).toMatchObject({ light: "green", label: "Good now", nextGoodTime: null });
    expect(va.plain.text).toMatch(/^Weekdays after 4pm/);
    expect(va.simple.breakdown).toEqual({ time: 3, lawn: 2, customer: 3, owner: 3 });
    expect(va.simple.points).toBe(11);
    expect(va.simple.label).toBe("hot");
    expect(va.medianIncome).toBe(85000);
    expect(va.strip).toHaveLength(7);
    expect(va.strip[0].day).toBe(1);
    expect("score" in va).toBe(false);
    expect("quintile" in va).toBe(false);

    // b: the homeowner's words win; it is a customer by county PIN, so its own customer row does not count for it.
    expect(vb.window.source).toBe("homeowner");
    expect(vb.isCustomer).toBe(true);
    expect(vb.simple.breakdown.customer).toBe(0);
    expect(vb.plain.text).toBe("Homeowner said: weekdays after 5.");

    // c: do not knock → nothing scores; never green.
    expect(vc.window.label).toBe("Do not knock");
    expect(vc.knock.light).toBe("red");
    expect(vc.simple.points).toBe(0);
    expect(vc.simple.label).toBe("low");
    expect(vc.plain.text).toBe("Do not knock");

    // d: unknown lot → "Lot size unknown", no price; customer_id set; "SMITH, MARIA" greets as Maria.
    expect(vd.turf_sqft_est).toBeNull();
    expect(vd.turfSource).toBeNull();
    expect(vd.quote).toMatchObject({ tier: null, status: "unknown_turf", price: null, label: "Lot size unknown" });
    expect(vd.isCustomer).toBe(true);
    expect(vd.ownerFirstName).toBe("Maria");
    expect(vd.simple.breakdown.lawn).toBe(1);
  });

  it("judges the light in a chosen slot and gives the next good time", () => {
    const p = parcelRow({ block_group_geoid: GEOID });
    // Sat 2026-10-31 10am Ohio: the block group's window is weekdays 4-6pm, so a Saturday morning is not a good time.
    const sat = assembleParcelViews({ ...base(), parcels: [p], knocks: [], slot: { at: new Date("2026-10-31T14:00:00.000Z") } })[0];
    expect(sat.knock.light).toBe("red");
    expect(sat.knock.nextGoodTime).toBe("Monday 4pm");
    expect(sat.simple.breakdown.time).toBe(0);
    const thu = assembleParcelViews({ ...base(), parcels: [p], knocks: [], slot: { at: new Date("2026-10-29T20:30:00.000Z") } })[0];
    expect(thu.knock.light).toBe("green");
    expect(thu.simple.breakdown.time).toBe(3);
    // No slot: "now" is the injected clock.
    expect(assembleParcelViews({ ...base(), parcels: [p], knocks: [] })[0].knock.light).toBe("green");
  });

  it("uses the learned layer for the window and the light once a group has enough knocks", () => {
    const p = parcelRow({ block_group_geoid: GEOID });
    const q = parcelRow({ block_group_geoid: GEOID });
    const knocks = Array.from({ length: 9 }, (_, i) =>
      knockRow({ parcel_id: i % 2 ? p.id : q.id, knocked_at: "2026-10-29T22:30:00.000Z", outcome: i < 8 ? "not_interested" : "no_answer" }),
    );
    const views = assembleParcelViews({ ...base(), parcels: [p, q], knocks, slot: { at: new Date("2026-10-29T22:30:00.000Z") } });
    expect(views[0].window.source).toBe("learned");
    expect(views[0].window.label).toBe("Weekdays 6–8pm likely");
    expect(views[0].plain.reason).toBe("that's when doors on this block have opened for us.");
    expect(views[0].knock.light).toBe("green"); // Thu 6:30pm
    const morning = assembleParcelViews({ ...base(), parcels: [p, q], knocks, slot: { at: new Date("2026-10-29T07:00:00.000Z") } });
    expect(morning[0].knock.light).toBe("red"); // Thu 3am
    expect(morning[0].knock.nextGoodTime).toBe("today 6pm");
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
