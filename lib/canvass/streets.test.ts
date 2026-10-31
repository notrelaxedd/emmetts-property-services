import { describe, expect, it } from "vitest";
import type { HangerCode } from "../db/types";
import type { HangerConversion } from "./hangers";
import { hangerCopy, mostCommonGeoid, streetTotals, streetsWithConversions } from "./streets";
import type { StreetRow } from "./views";

const code = (c: string, street: string, active = true): HangerCode => ({
  id: `id-${c}`,
  code: c,
  street,
  block_group_geoid: null,
  active,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

const conv = (c: string, street: string, scans: number, bookings: number): HangerConversion => ({
  code: c,
  street,
  scans,
  bookings,
  rate: scans > 0 ? bookings / scans : null,
});

describe("streetsWithConversions", () => {
  const streets: StreetRow[] = [
    { street: "WOOSTER RD", parcels: 40, block_group_geoid: "390351621021", code: code("K7M2", "WOOSTER RD") },
    { street: "ELMWOOD AVE", parcels: 12, block_group_geoid: null, code: null },
    { street: "BEACH CLIFF BLVD", parcels: 25, block_group_geoid: "390351621022", code: code("ABCD", "BEACH CLIFF BLVD") },
  ];

  it("sums scans and bookings over every code for the street and sorts by street", () => {
    const rows = streetsWithConversions(streets, [
      conv("K7M2", "WOOSTER RD", 10, 1),
      conv("OLD1", "wooster rd ", 5, 2),
      conv("ABCD", "BEACH CLIFF BLVD", 0, 0),
      conv("ZZZZ", "NOWHERE ST", 9, 9),
    ]);
    expect(rows.map((r) => r.street)).toEqual(["BEACH CLIFF BLVD", "ELMWOOD AVE", "WOOSTER RD"]);
    const wooster = rows[2];
    expect(wooster.scans).toBe(15);
    expect(wooster.bookings).toBe(3);
    expect(wooster.rate).toBeCloseTo(0.2);
    expect(wooster.code?.code).toBe("K7M2");
    expect(rows[0]).toMatchObject({ scans: 0, bookings: 0, rate: null });
    expect(rows[1]).toMatchObject({ scans: 0, bookings: 0, rate: null, code: null });
  });

  it("totals the table", () => {
    const rows = streetsWithConversions(streets, [conv("K7M2", "WOOSTER RD", 10, 1), conv("ABCD", "BEACH CLIFF BLVD", 4, 1)]);
    expect(streetTotals(rows)).toEqual({ streets: 3, parcels: 77, withCode: 2, scans: 14, bookings: 2, rate: 2 / 14 });
    expect(streetTotals([])).toEqual({ streets: 0, parcels: 0, withCode: 0, scans: 0, bookings: 0, rate: null });
  });
});

describe("mostCommonGeoid", () => {
  it("picks the geoid most parcels share, ignoring unassigned parcels", () => {
    expect(
      mostCommonGeoid([
        { block_group_geoid: null },
        { block_group_geoid: "B" },
        { block_group_geoid: "A" },
        { block_group_geoid: "A" },
        { block_group_geoid: "B" },
        { block_group_geoid: "A" },
      ]),
    ).toBe("A");
  });

  it("returns null when nothing is assigned and the first seen on a tie", () => {
    expect(mostCommonGeoid([])).toBeNull();
    expect(mostCommonGeoid([{ block_group_geoid: null }])).toBeNull();
    expect(mostCommonGeoid([{ block_group_geoid: "B" }, { block_group_geoid: "A" }])).toBe("B");
  });
});

describe("hangerCopy", () => {
  it("uses the owner's offer text when set, else the season default", () => {
    const season = { service: "leaf_cleanup" as const, offer: "Neighbor rate on leaf cleanup." };
    expect(hangerCopy(season, null)).toEqual({
      headline: "Leaf cleanup on your street",
      offer: "Neighbor rate on leaf cleanup.",
      bullets: ["Lawn and beds cleared of leaves", "Gutters cleared on request", "Done before the first snow"],
    });
    expect(hangerCopy(season, "   ").offer).toBe("Neighbor rate on leaf cleanup.");
    expect(hangerCopy(season, "First cleanup $20 off").offer).toBe("First cleanup $20 off");
  });

  it("has three bullets and a headline for every service", () => {
    for (const service of ["mow", "edge", "leaf_cleanup", "gutters", "snow"] as const) {
      const c = hangerCopy({ service, offer: "x" }, null);
      expect(c.bullets).toHaveLength(3);
      expect(c.headline.length).toBeGreaterThan(0);
      expect(c.headline).not.toContain("—");
    }
  });
});
