import { describe, expect, it } from "vitest";
import {
  boundsOf,
  formatMoney,
  formatSqft,
  geomToLatLngs,
  outcomeLabel,
  scoreColor,
  toMapParcel,
  toParcelRow,
  yesNo,
  areaLight,
} from "./admin-rows";
import { assembleParcelViews } from "./assemble";
import { canvassSettingsRow, knockRow, lotAt, parcelRow } from "./rows.fixture";
import { seasonFocus } from "./season";

const settings = canvassSettingsRow();
const season = seasonFocus(10, settings.season_map);

function views(parcels = [parcelRow()], knocks = [] as ReturnType<typeof knockRow>[]) {
  return assembleParcelViews({
    parcels,
    knocks,
    blockGroups: new Map(),
    knockerNames: new Map([["k1", "Emmett"]]),
    customers: [],
    settings,
    season,
    now: new Date("2026-10-29T21:15:00.000Z"),
    learned: new Map(),
    slot: null,
  });
}

describe("toParcelRow / toMapParcel", () => {
  it("keeps the table fields and drops raw and geom", () => {
    const p = parcelRow({ turf_sqft_traced: 3000, turf_sqft_est: 5000 });
    const [v] = views([p], [knockRow({ parcel_id: p.id, knocker_id: "k1", outcome: "booked", knocked_at: "2026-10-20T20:00:00.000Z" })]);
    const row = toParcelRow(v);
    expect(row.id).toBe(p.id);
    expect(row.turf_sqft).toBe(3000);
    expect(row.turfSource).toBe("traced");
    expect(row.lastOutcome).toBe("booked");
    expect(row.lastKnockAt).toBe("2026-10-20T20:00:00.000Z");
    expect(row.knockCount).toBe(1);
    expect(row.windowLabel).toBe(v.window.label);
    expect(row.fullAddress).toBe("19000 Detroit Rd, Rocky River, OH 44116");
    expect(row.ownerFirstName).toBe("John");
    expect(row.quotePrice).toBe(v.quote.price);
    expect(row.quoteLabel).toBe(v.quote.label);
    expect(row.scorePoints).toBe(v.simple.points);
    expect(row.scoreLabel).toBe(v.simple.label);
    expect(row.light).toBe(v.knock.light);
    expect(row.plainText).toBe(v.plain.text);
    expect(row.scoreReason).toBe(v.simple.reasons.length ? row.scoreReason : "");
    expect("score" in row).toBe(false);
    expect("quintile" in row).toBe(false);
    expect("raw" in row).toBe(false);
    expect("geom" in row).toBe(false);
    const m = toMapParcel(v);
    expect(m?.geom).toEqual(p.geom);
    expect(Object.keys(m ?? {}).sort()).toEqual(["do_not_knock", "geom", "id", "isCustomer", "label"])
    expect(m?.label).toBe(v.simple.label);
  });
  it("falls back to the estimate and returns null map entries without geometry", () => {
    const p = parcelRow({ turf_sqft_traced: null, turf_sqft_est: 4200, geom: null });
    const [v] = views([p]);
    // The assembler recomputes the estimate live from settings.hardscape_pct, so compare with the view.
    expect(v.turf_sqft_est).not.toBeNull();
    expect(toParcelRow(v).turf_sqft).toBe(v.turf_sqft_est);
    expect(toParcelRow(v).turfSource).toBe("estimate");
    expect(toParcelRow(v).lastOutcome).toBeNull();
    expect(toMapParcel(v)).toBeNull();
  });
});

describe("labels and formatting", () => {
  it("labels outcomes and nulls", () => {
    expect(outcomeLabel("no_answer")).toBe("No answer");
    expect(outcomeLabel(null)).toBe("Not knocked");
  });
  it("formats numbers without em dashes", () => {
    expect(formatSqft(12400.4)).toBe("12,400");
    expect(formatSqft(null)).toBe("");
    expect(formatMoney(285400)).toBe("$285,400");
    expect(yesNo(true)).toBe("Yes");
    expect(yesNo(null)).toBe("?");
  });
});

describe("areaLight", () => {
  const r = (light: "green" | "yellow" | "red", do_not_knock = false) => ({ light, do_not_knock });
  it("is the majority light of the houses that can be knocked", () => {
    expect(areaLight([r("green"), r("green"), r("red")])).toBe("green");
    expect(areaLight([r("red"), r("red"), r("yellow"), r("green")])).toBe("red");
    expect(areaLight([r("yellow"), r("yellow"), r("green"), r("red")])).toBe("yellow");
  });
  it("ties go to the better light, do-not-knock houses do not vote, nobody gives null", () => {
    expect(areaLight([r("green"), r("red")])).toBe("green");
    expect(areaLight([r("yellow"), r("red")])).toBe("yellow");
    expect(areaLight([r("red"), r("green", true), r("green", true)])).toBe("red");
    expect(areaLight([])).toBeNull();
    expect(areaLight([r("green", true)])).toBeNull();
  });
});

describe("scoreColor", () => {
  it("hot is brand green, good amber, low gray", () => {
    expect(scoreColor("hot")).toBe("#65C435");
    expect(scoreColor("good")).toBe("#F59E0B");
    expect(scoreColor("low")).toBe("#9A9E9C");
  });
});

describe("geometry for Leaflet", () => {
  it("swaps lng/lat and wraps a Polygon as one polygon", () => {
    const geom = lotAt(-81.84, 41.47);
    const rings = geomToLatLngs(geom);
    expect(rings).toHaveLength(1);
    expect(rings[0][0][0]).toEqual([41.47, -81.84]);
  });
  it("computes bounds across MultiPolygons and returns null when empty", () => {
    const a = lotAt(-81.84, 41.47);
    const multi = { type: "MultiPolygon" as const, coordinates: [lotAt(-81.8, 41.5).coordinates] };
    const b = boundsOf([{ geom: a }, { geom: multi }]);
    expect(b).not.toBeNull();
    expect(b![0][0]).toBeCloseTo(41.47, 6);
    expect(b![0][1]).toBeCloseTo(-81.84, 6);
    expect(b![1][0]).toBeCloseTo(41.5003, 6);
    expect(b![1][1]).toBeCloseTo(-81.7998, 6);
    expect(boundsOf([])).toBeNull();
  });
});
