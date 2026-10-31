import { describe, expect, it } from "vitest";
import {
  boundsOf,
  formatMoney,
  formatQuote,
  formatSqft,
  geomToLatLngs,
  outcomeLabel,
  percentLabel,
  QUINTILE_COLORS,
  scoreColor,
  toMapParcel,
  toParcelRow,
  yesNo,
} from "./admin-rows";
import { assembleParcelViews } from "./assemble";
import { canvassSettingsRow, knockRow, lotAt, parcelRow } from "./rows.fixture";
import { emptyConvertModel } from "./score";
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
    model: emptyConvertModel(),
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
    expect(row.quoteLow).toBe(v.quote.low);
    expect("raw" in row).toBe(false);
    expect("geom" in row).toBe(false);
    const m = toMapParcel(v);
    expect(m?.geom).toEqual(p.geom);
    expect(Object.keys(m ?? {}).sort()).toEqual(["do_not_knock", "geom", "id", "isCustomer", "quintile"]);
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
    expect(formatQuote(45, 60)).toBe("$45–$60");
    expect(yesNo(true)).toBe("Yes");
    expect(yesNo(null)).toBe("?");
    expect(percentLabel(0.3249)).toBe("32%");
    expect(percentLabel(2)).toBe("100%");
  });
});

describe("scoreColor", () => {
  it("runs gray to green and clamps", () => {
    expect(scoreColor(0)).toBe(QUINTILE_COLORS[0]);
    expect(scoreColor(4)).toBe(QUINTILE_COLORS[4]);
    expect(scoreColor(9)).toBe(QUINTILE_COLORS[4]);
    expect(scoreColor(-1)).toBe(QUINTILE_COLORS[0]);
    expect(scoreColor(Number.NaN)).toBe(QUINTILE_COLORS[0]);
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
