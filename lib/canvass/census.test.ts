import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACS_TABLES,
  acsDataUrl,
  acsGroupUrl,
  acsValue,
  fetchAllBlockGroupTables,
  fetchBlockGroupTable,
  labelPath,
  parseAcs,
  parseAcsRows,
  parseCommuteLabel,
  parseDepartLabel,
  resolveVariables,
  typicalCommute,
  typicalDepart,
  type AcsTable,
} from "./census";
import { GEOID_A, GEOID_B, allGroups, dataFixtures, dataResponse, groupB23007Live } from "./census.fixture";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (f: unknown) => f as typeof fetch;

/** A fetch that serves the group JSON and the data response for any of the six tables. */
function censusFetch() {
  return vi.fn(async (url: string) => {
    const group = /\/groups\/(B\d+)\.json$/.exec(url);
    if (group) return json(allGroups[group[1] as AcsTable]);
    const get = new URL(url).searchParams.get("get") ?? "";
    const ids = get.split(",").slice(1);
    const table = ids[0]?.slice(0, 6) as AcsTable;
    return json(dataResponse(ids, dataFixtures[table]));
  });
}

describe("URLs", () => {
  it("builds group and data URLs for Cuyahoga block groups, with an optional key", () => {
    expect(acsGroupUrl("B08302", "2023")).toBe("https://api.census.gov/data/2023/acs/acs5/groups/B08302.json");
    expect(acsDataUrl(["B23025_001E", "B23025_007E"], "2023")).toBe(
      "https://api.census.gov/data/2023/acs/acs5?get=NAME,B23025_001E,B23025_007E&for=block%20group:*&in=state:39&in=county:035&in=tract:*",
    );
    expect(acsDataUrl(["B19013_001E"], "2022", "abc")).toMatch(/&key=abc$/);
  });
});

describe("label helpers", () => {
  it("labelPath drops Estimate and trailing colons", () => {
    expect(labelPath("Estimate!!Total:!!Male:!!65 and 66 years")).toEqual(["total", "male", "65 and 66 years"]);
    expect(labelPath("Estimate!!Total:")).toEqual(["total"]);
    expect(labelPath("Estimate!!Total")).toEqual(["total"]);
  });
  it("parses departure and commute bucket labels", () => {
    expect(parseDepartLabel("12:00 a.m. to 4:59 a.m.")).toEqual([0, 5]);
    expect(parseDepartLabel("7:30 a.m. to 7:59 a.m.")).toEqual([7.5, 8]);
    expect(parseDepartLabel("12:00 p.m. to 3:59 p.m.")).toEqual([12, 16]);
    expect(parseDepartLabel("4:00 p.m. to 11:59 p.m.")).toEqual([16, 24]);
    expect(parseDepartLabel("Total")).toBeNull();
    expect(parseCommuteLabel("Less than 5 minutes")).toEqual([0, 5]);
    expect(parseCommuteLabel("45 to 59 minutes")).toEqual([45, 60]);
    expect(parseCommuteLabel("90 or more minutes")).toEqual([90, 120]);
    expect(parseCommuteLabel("Total")).toBeNull();
  });
  it("acsValue turns Census sentinels and junk into null", () => {
    expect(acsValue("-666666666")).toBeNull();
    expect(acsValue(-999999999)).toBeNull();
    expect(acsValue(null)).toBeNull();
    expect(acsValue("n/a")).toBeNull();
    expect(acsValue("42")).toBe(42);
    expect(acsValue(0)).toBe(0);
  });
});

describe("resolveVariables", () => {
  it("B08302: total + every departure bucket with hours", () => {
    const r = resolveVariables("B08302", allGroups.B08302);
    expect(r.total).toBe("B08302_001E");
    expect(r.parts).toHaveLength(14);
    expect(r.parts[0]).toEqual({ id: "B08302_002E", label: "12:00 a.m. to 4:59 a.m.", role: "bucket", start: 0, end: 5 });
    expect(r.ids[0]).toBe("B08302_001E");
    expect(r.ids).not.toContain("B08302_001M");
    expect(r.ids).not.toContain("B08302_001EA");
  });
  it("B08303: total + every commute bucket with minutes", () => {
    const r = resolveVariables("B08303", allGroups.B08303);
    expect(r.parts).toHaveLength(12);
    expect(r.parts.at(-1)).toEqual({ id: "B08303_013E", label: "90 or more minutes", role: "bucket", start: 90, end: 120 });
  });
  it("B23025: total + Not in labor force only", () => {
    const r = resolveVariables("B23025", allGroups.B23025);
    expect(r.ids).toEqual(["B23025_001E", "B23025_007E"]);
  });
  it("B01001: the twelve 65+ buckets, male and female", () => {
    const r = resolveVariables("B01001", allGroups.B01001);
    expect(r.parts.map((p) => p.id)).toEqual([
      "B01001_020E",
      "B01001_021E",
      "B01001_022E",
      "B01001_023E",
      "B01001_024E",
      "B01001_025E",
      "B01001_044E",
      "B01001_045E",
      "B01001_046E",
      "B01001_047E",
      "B01001_048E",
      "B01001_049E",
    ]);
  });
  it("B23007 (live 2023 labels): wife-not-in-LF leaves, the husband-not-in-LF subtotal and both single-parent cells", () => {
    const r = resolveVariables("B23007", groupB23007Live);
    expect(r.total).toBe("B23007_001E");
    expect(r.parts.find((p) => p.role === "families_with_children")?.id).toBe("B23007_002E");
    // 019 (wife not in LF under husband not in LF) is inside 015 and must not be double counted;
    // 048 / 059 are in the "No children" subtree.
    expect(r.parts.filter((p) => p.role === "nonworking_parent").map((p) => p.id)).toEqual([
      "B23007_009E",
      "B23007_014E",
      "B23007_015E",
      "B23007_025E",
      "B23007_030E",
    ]);
  });

  it("B23007 (older wording): families with children + the five non-working-parent cells (never the 'no own children' subtree)", () => {
    const r = resolveVariables("B23007", allGroups.B23007);
    expect(r.parts.find((p) => p.role === "families_with_children")?.id).toBe("B23007_002E");
    expect(r.parts.filter((p) => p.role === "nonworking_parent").map((p) => p.id)).toEqual([
      "B23007_005E",
      "B23007_006E",
      "B23007_007E",
      "B23007_011E",
      "B23007_014E",
    ]);
  });
  it("B19013: the median income variable, no total", () => {
    const r = resolveVariables("B19013", allGroups.B19013);
    expect(r.total).toBeNull();
    expect(r.ids).toEqual(["B19013_001E"]);
  });
  it("tolerates labels without trailing colons", () => {
    const r = resolveVariables("B23025", {
      variables: { B23025_001E: { label: "Estimate!!Total" }, B23025_007E: { label: "Estimate!!Total!!Not in labor force" } },
    });
    expect(r.ids).toEqual(["B23025_001E", "B23025_007E"]);
  });
  it("throws when the expected labels are not in the group (a changed layout)", () => {
    expect(() => resolveVariables("B23025", { variables: { B23025_001E: { label: "Estimate!!Total:" } } })).toThrow(/B23025/);
    expect(() => resolveVariables("B23007", { variables: { B23007_001E: { label: "Estimate!!Total:" } } })).toThrow(/B23007/);
  });
});

describe("fetchBlockGroupTable / parseAcsRows", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("fetches the group JSON then the county-wide block-group rows, keyed by 12-digit GEOID", async () => {
    delete process.env.CENSUS_API_KEY;
    const f = censusFetch();
    const t = await fetchBlockGroupTable("B23025", { fetchImpl: asFetch(f), vintage: "2023" });
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(acsGroupUrl("B23025", "2023"));
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe(acsDataUrl(["B23025_001E", "B23025_007E"], "2023"));
    expect(t.rows).toEqual([
      { geoid: GEOID_A, values: { B23025_001E: 900, B23025_007E: 420 } },
      { geoid: GEOID_B, values: { B23025_001E: 500, B23025_007E: null } },
    ]);
  });

  it("uses CENSUS_API_KEY when set and skips the group call when variables are pre-resolved", async () => {
    process.env.CENSUS_API_KEY = "secret";
    const f = censusFetch();
    const resolved = resolveVariables("B19013", allGroups.B19013);
    await fetchBlockGroupTable("B19013", { fetchImpl: asFetch(f), resolved });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toMatch(/&key=secret$/);
  });

  it("surfaces HTTP errors and rejects responses without geography columns", async () => {
    const bad = vi.fn(async () => new Response("Service Unavailable", { status: 503 }));
    await expect(fetchBlockGroupTable("B23025", { fetchImpl: asFetch(bad) })).rejects.toThrow(/census group B23025 503/);
    expect(() => parseAcsRows([["NAME", "B23025_001E"], ["x", 1]], ["B23025_001E"])).toThrow(/geography columns/);
    expect(parseAcsRows(null, [])).toEqual([]);
  });

  it("fetchAllBlockGroupTables pulls the six tables sequentially", async () => {
    const f = censusFetch();
    const all = await fetchAllBlockGroupTables({ fetchImpl: asFetch(f), key: null });
    expect(Object.keys(all).sort()).toEqual([...ACS_TABLES].sort());
    expect(f).toHaveBeenCalledTimes(12);
  });
});

describe("parseAcs", () => {
  it("computes block-group stats, with sentinels → null and distributions keyed by bucket label", async () => {
    const f = censusFetch();
    const stats = parseAcs(await fetchAllBlockGroupTables({ fetchImpl: asFetch(f), key: null }));
    expect(Array.from(stats.keys())).toEqual([GEOID_A, GEOID_B]);
    const a = stats.get(GEOID_A)!;
    expect(a.pct_not_in_lf).toBeCloseTo(420 / 900, 4);
    expect(a.pct_65_plus).toBeCloseTo(325 / 1100, 4);
    expect(a.pct_hh_nonworking_parent).toBeCloseTo(75 / 200, 4);
    expect(a.median_hh_income).toBe(98750);
    expect(a.depart_dist["7:30 a.m. to 7:59 a.m."]).toBe(80);
    expect(Object.keys(a.depart_dist)).toHaveLength(14);
    expect(a.commute_dist["20 to 24 minutes"]).toBe(80);
    expect(Object.keys(a.commute_dist)).toHaveLength(12);

    const b = stats.get(GEOID_B)!;
    expect(b.pct_not_in_lf).toBeNull();
    expect(b.median_hh_income).toBeNull();
    expect(b.pct_hh_nonworking_parent).toBeCloseTo(0.2, 4);
  });

  it("gives nulls for a table that was not fetched", () => {
    const stats = parseAcs({ B23025: { resolved: resolveVariables("B23025", allGroups.B23025), rows: [{ geoid: GEOID_A, values: { B23025_001E: 10, B23025_007E: 4 } }] } });
    expect(stats.get(GEOID_A)).toEqual({
      pct_not_in_lf: 0.4,
      pct_hh_nonworking_parent: null,
      pct_65_plus: null,
      median_hh_income: null,
      depart_dist: {},
      commute_dist: {},
    });
  });
});

describe("typicalDepart / typicalCommute", () => {
  it("weighted median bucket midpoints", async () => {
    const f = censusFetch();
    const stats = parseAcs(await fetchAllBlockGroupTables({ fetchImpl: asFetch(f), key: null }));
    const a = stats.get(GEOID_A)!;
    expect(typicalDepart(a.depart_dist)).toBe(7.75); // 7:30–7:59 bucket
    expect(typicalCommute(a.commute_dist)).toBe(22.5); // 20–24 minutes bucket
    const b = stats.get(GEOID_B)!;
    expect(typicalDepart(b.depart_dist)).toBe(8.25); // 8:00–8:29 bucket
  });
  it("is null for empty or unparseable distributions", () => {
    expect(typicalDepart({})).toBeNull();
    expect(typicalDepart(null)).toBeNull();
    expect(typicalDepart({ Total: 100 })).toBeNull();
    expect(typicalCommute({ "Less than 5 minutes": 0 })).toBeNull();
    expect(typicalCommute({ "90 or more minutes": 3 })).toBe(105);
  });
});
