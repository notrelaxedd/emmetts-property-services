import { describe, expect, it } from "vitest";
import {
  answerProbabilityFor,
  assembleParcelViews,
  convertRowsFrom,
  fitModelFrom,
  knockSummary,
  learnedGroupKey,
  learnedWindowsFor,
  neighborBoostFor,
  representativeSlot,
} from "./assemble";
import { blockGroupRow, canvassSettingsRow, knockRow, parcelRow } from "./rows.fixture";
import { emptyConvertModel } from "./score";
import { seasonFocus } from "./season";
import { answerProbability, learnedWindow } from "./windows";

const settings = canvassSettingsRow();
const season = seasonFocus(10, settings.season_map); // October → leaf cleanup
const GEOID = "390351621021";
const bg = blockGroupRow({ geoid: GEOID });
const blockGroups = new Map([[GEOID, bg]]);
const names = new Map([["knocker-a", "Emmett"]]);

const base = () => ({ blockGroups, knockerNames: names, customers: [], settings, season, model: emptyConvertModel() });

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

describe("conversion rows", () => {
  it("joins knocks to their parcels' features and skips unknown parcels", () => {
    const p = parcelRow({ lot_sqft: 5000, owner_occupied: false, street: "ELM ST" });
    const rows = convertRowsFrom(
      [knockRow({ parcel_id: p.id, outcome: "booked", knocker_id: "k1", pitch_id: "p1" }), knockRow({ parcel_id: "nope" })],
      [p],
      [],
      settings,
    );
    expect(rows).toEqual([{ outcome: "booked", lotBand: "small", ownerOccupied: false, nearCustomer: false, street: "ELM ST", knockerId: "k1", pitchId: "p1" }]);
    const model = fitModelFrom([knockRow({ parcel_id: p.id, outcome: "booked" })], [p], [], settings);
    expect(model.n).toBe(1);
    expect(model.converts).toBe(1);
  });
});

describe("neighbor boost", () => {
  it("ignores the parcel's own customer row but counts a neighbour", () => {
    const p = parcelRow({ customer_id: "c-self", parcel_id: "PIN-1", address: "19000 DETROIT RD" });
    const self = { id: "c-self", address: "19000 Detroit Rd", lat: p.centroid_lat, lng: p.centroid_lng, parcel_id: "PIN-1" };
    expect(neighborBoostFor(p, [self], settings)).toBe(1);
    const neighbour = { id: "c-2", address: "19004 Detroit Rd", lat: null, lng: null, parcel_id: null };
    expect(neighborBoostFor(p, [self, neighbour], settings)).toBe(1.5);
  });
});

describe("answer probability", () => {
  it("uses the prior bucket mean inside the window and the other prior outside, without learned data", () => {
    const window = { kind: "range" as const, days: "weekdays" as const, start: 16, end: 18 };
    expect(representativeSlot(window)).toEqual({ weekday: 1, hour: 16 });
    expect(answerProbabilityFor(window, null, null)).toBeCloseTo(answerProbability({ knocks: 0, answers: 0, isPrior: true }), 10);
    expect(answerProbabilityFor(window, null, { weekday: 2, hour: 10 })).toBeCloseTo(answerProbability({ knocks: 0, answers: 0, isPrior: false }), 10);
    expect(answerProbabilityFor(window, null, { weekday: 6, hour: 16 })).toBeCloseTo(0.25, 10);
  });
  it("prefers the learned bucket's posterior mean for the slot", () => {
    const window = { kind: "range" as const, days: "weekdays" as const, start: 16, end: 18 };
    const knocks = Array.from({ length: 8 }, (_, i) => ({ knocked_at: "2026-10-29T22:30:00.000Z", outcome: i < 6 ? ("booked" as const) : ("no_answer" as const) }));
    const learned = learnedWindow(knocks, window, 8);
    expect(learned).not.toBeNull();
    // Thu 6pm bucket: (1 + 6) / (1 + 3 + 8)
    expect(answerProbabilityFor(window, learned, { weekday: 4, hour: 18 })).toBeCloseTo(7 / 12, 10);
    // Off hours → falls back to the prior rule.
    expect(answerProbabilityFor(window, learned, { weekday: 4, hour: 2 })).toBeCloseTo(0.25, 10);
  });
});

describe("assembleParcelViews", () => {
  it("resolves window, quotes, score, last knock, customer flag and quintiles", () => {
    const a = parcelRow({ block_group_geoid: GEOID, lot_sqft: 8276.4, living_sqft: 1624, stories: 1.5, address: "19000 DETROIT RD" });
    const b = parcelRow({ block_group_geoid: GEOID, callback_window: "weekdays after 5", address: "19004 DETROIT RD", parcel_id: "PIN-B" });
    const c = parcelRow({ block_group_geoid: null, do_not_knock: true, do_not_knock_reason: "sign", address: "19008 DETROIT RD" });
    const d = parcelRow({ block_group_geoid: GEOID, lot_sqft: null, living_sqft: null, address: "19012 DETROIT RD", customer_id: "cust-d" });
    const knocks = [
      knockRow({ parcel_id: a.id, knocked_at: "2026-10-20T21:00:00.000Z", outcome: "no_answer" }),
      knockRow({ parcel_id: a.id, knocked_at: "2026-10-28T21:00:00.000Z", outcome: "call_back" }),
    ];
    const customers = [{ id: "cust-x", address: "19002 Detroit Rd", lat: null, lng: null, parcel_id: "PIN-B" }];
    const views = assembleParcelViews({ ...base(), parcels: [a, b, c, d], knocks, customers });
    const [va, vb, vc, vd] = views;

    // a: ACS prior window from the block group; the estimate is recomputed from settings (lot − footprint − 12%).
    expect(va.window.source).toBe("acs");
    expect(va.window.label).toBe("Weekdays 4–6pm likely");
    expect(va.turf_sqft_est).toBe(Math.round(8276.4 - 1624 / 1.5 - 8276.4 * 0.12));
    expect(va.turfSource).toBe("estimate");
    expect(va.quote).toEqual(va.quotes.leaf_cleanup);
    expect(va.quote.mid).toBe(Math.round(150 + (6 * va.turf_sqft_est!) / 1000));
    expect(va.lastKnock).toEqual({ knocked_at: "2026-10-28T21:00:00.000Z", outcome: "call_back", knocker_name: "Emmett" });
    expect(va.knockCount).toBe(2);
    expect(va.isCustomer).toBe(false);
    expect(va.breakdown.pAnswer).toBeCloseTo(4 / 6, 10);
    expect(va.breakdown.pConvert).toBeCloseTo(0.08, 10);
    expect(va.breakdown.neighborBoost).toBe(1.5); // 19002 is one house from 19000 on the same street
    expect(va.score).toBeCloseTo((4 / 6) * 0.08 * va.quote.mid * 1.5, 1);

    // b: the homeowner's words win; it is a customer by county PIN.
    expect(vb.window.source).toBe("homeowner");
    expect(vb.isCustomer).toBe(true);
    expect(vb.breakdown.neighborBoost).toBe(1); // its own customer row does not boost it

    // c: do not knock → score 0, lowest quintile.
    expect(vc.window.label).toBe("Do not knock");
    expect(vc.score).toBe(0);
    expect(vc.quintile).toBe(0);

    // d: unknown lot → base price only; customer_id set.
    expect(vd.turf_sqft_est).toBeNull();
    expect(vd.turfSource).toBeNull();
    expect(vd.quote.mid).toBe(150);
    expect(vd.isCustomer).toBe(true);

    const quintiles = views.map((v) => v.quintile);
    expect(Math.max(...quintiles)).toBeGreaterThan(0);
    expect(views.every((v) => v.quintile >= 0 && v.quintile <= 4)).toBe(true);
  });

  it("judges P(answer) in a chosen slot and uses the learned layer once a group has enough knocks", () => {
    const p = parcelRow({ block_group_geoid: GEOID });
    const q = parcelRow({ block_group_geoid: GEOID });
    const knocks = Array.from({ length: 9 }, (_, i) =>
      knockRow({ parcel_id: i % 2 ? p.id : q.id, knocked_at: "2026-10-29T22:30:00.000Z", outcome: i < 8 ? "not_interested" : "no_answer" }),
    );
    const views = assembleParcelViews({ ...base(), parcels: [p, q], knocks, slot: { weekday: 4, hour: 18 } });
    expect(views[0].window.source).toBe("learned");
    expect(views[0].window.label).toBe("Weekdays 6–8pm likely");
    expect(views[0].breakdown.pAnswer).toBeCloseTo((1 + 8) / (1 + 3 + 9), 10);
    const morning = assembleParcelViews({ ...base(), parcels: [p, q], knocks, slot: { weekday: 4, hour: 8 } });
    expect(morning[0].breakdown.pAnswer).toBeCloseTo(1 / 4, 10);
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
