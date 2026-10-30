import { describe, expect, it } from "vitest";
import { CANVASS_SETTINGS_ID } from "../db/types";
import type { CanvassSettings } from "../db/types";
import { fakeDb } from "../ops/test-utils";
import {
  DEFAULT_BASE_PRICES,
  DEFAULT_SEASON_MAP,
  getCanvassSettings,
  mergeBasePrices,
  mergeParcelFieldMap,
  mergeSeasonMap,
  updateCanvassSettings,
} from "./settings";
import { PARCEL_FIELD_KEYS, emptyParcelFieldMap } from "./types";

const T0 = "2026-01-01T00:00:00.000Z";

/** A row exactly as the migration seeds it. */
function canvassSettingsRow(over: Partial<CanvassSettings> = {}): CanvassSettings {
  return {
    id: CANVASS_SETTINGS_ID, created_at: T0, updated_at: T0,
    hardscape_pct: 0.12, rate_per_1000_sqft: 6, min_charge: 40,
    base_prices: { ...DEFAULT_BASE_PRICES },
    value_tier_enabled: false, value_tier_max: 1.1, doors_per_hour: 25, neighbor_n: 3, recency_days: 14,
    daytime_not_in_lf_threshold: 0.4, daytime_nonworking_parent_threshold: 0.35, work_hours: 8.5,
    learned_min_knocks: 8, season_map: { ...DEFAULT_SEASON_MAP },
    residential_land_use_prefixes: ["510", "511", "512", "513", "514", "515", "516", "517", "518", "519"],
    // The column default `{}` (a patch, not a full map): getCanvassSettings fills every key.
    parcel_field_map: {} as never, acs_vintage: "2023", offer_text: null,
    ...over,
  };
}

describe("defaults", () => {
  it("DEFAULT_BASE_PRICES / DEFAULT_SEASON_MAP mirror the migration column defaults", () => {
    expect(DEFAULT_BASE_PRICES).toEqual({ mow: 35, edge: 15, leaf_cleanup: 150, gutters: 120, snow: 45 });
    expect(Object.keys(DEFAULT_SEASON_MAP)).toHaveLength(12);
    expect(DEFAULT_SEASON_MAP["1"]).toBe("snow");
    expect(DEFAULT_SEASON_MAP["4"]).toBe("mow");
    expect(DEFAULT_SEASON_MAP["9"]).toBe("leaf_cleanup");
    expect(DEFAULT_SEASON_MAP["12"]).toBe("snow");
  });
});

describe("merge helpers", () => {
  it("mergeBasePrices fills missing / bad values from the defaults and applies a patch", () => {
    expect(mergeBasePrices(null)).toEqual(DEFAULT_BASE_PRICES);
    expect(mergeBasePrices({ mow: 50, snow: "x", edge: -1 })).toEqual({ ...DEFAULT_BASE_PRICES, mow: 50 });
    expect(mergeBasePrices({ mow: 50 }, { gutters: 99 })).toEqual({ ...DEFAULT_BASE_PRICES, mow: 50, gutters: 99 });
    expect(mergeBasePrices([1, 2])).toEqual(DEFAULT_BASE_PRICES);
  });
  it("mergeSeasonMap keeps every month and drops unknown services", () => {
    expect(mergeSeasonMap(undefined)).toEqual(DEFAULT_SEASON_MAP);
    const m = mergeSeasonMap({ "9": "mow", "10": "bogus" }, { "1": "gutters" });
    expect(m["9"]).toBe("mow");
    expect(m["10"]).toBe("leaf_cleanup");
    expect(m["1"]).toBe("gutters");
    expect(Object.keys(m)).toHaveLength(12);
  });
  it("mergeParcelFieldMap merges key by key", () => {
    const stored = { parcel_id: { field: "parcelpin", source: "auto" as const, candidates: ["parcelpin"] } };
    const out = mergeParcelFieldMap(stored, { owner: { field: "deeded_owner", source: "manual", candidates: [] } });
    expect(out.parcel_id.field).toBe("parcelpin");
    expect(out.owner.source).toBe("manual");
    // Every FieldKey is present; unresolved ones read "missing".
    expect(Object.keys(out).sort()).toEqual([...PARCEL_FIELD_KEYS].sort());
    expect(out.street).toEqual({ field: null, source: "missing", candidates: [] });
    expect(mergeParcelFieldMap("garbage")).toEqual(emptyParcelFieldMap());
    // Malformed entries are dropped; layer metadata is kept.
    const junk = mergeParcelFieldMap({ owner: { field: 5 }, layer_name: "Parcels", fetched_at: "2026-10-30T00:00:00Z" });
    expect(junk.owner.source).toBe("missing");
    expect(junk.layer_name).toBe("Parcels");
    expect(junk.fetched_at).toBe("2026-10-30T00:00:00Z");
  });
});

describe("getCanvassSettings", () => {
  it("returns the seeded row with JSON columns merged over the defaults", async () => {
    const db = fakeDb({
      canvass_settings: [canvassSettingsRow({ base_prices: { mow: 40 } as never, season_map: {} as never })],
    });
    const s = await getCanvassSettings(db);
    expect(s.id).toBe(CANVASS_SETTINGS_ID);
    expect(s.base_prices).toEqual({ ...DEFAULT_BASE_PRICES, mow: 40 });
    expect(s.season_map).toEqual(DEFAULT_SEASON_MAP);
    expect(s.parcel_field_map).toEqual(emptyParcelFieldMap());
    expect(s.doors_per_hour).toBe(25);
  });
  it("throws when the row is missing", async () => {
    await expect(getCanvassSettings(fakeDb())).rejects.toThrow(/missing/);
  });
});

describe("updateCanvassSettings", () => {
  it("updates scalar columns and leaves the JSON columns alone", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const s = await updateCanvassSettings(db, { doors_per_hour: 30, offer_text: "Fall special" });
    expect(s.doors_per_hour).toBe(30);
    expect(s.offer_text).toBe("Fall special");
    expect(s.base_prices).toEqual(DEFAULT_BASE_PRICES);
    expect(db.tables.canvass_settings[0].doors_per_hour).toBe(30);
  });
  it("merges base_prices / season_map / parcel_field_map per key instead of replacing them", async () => {
    const db = fakeDb({
      canvass_settings: [
        canvassSettingsRow({
          base_prices: { ...DEFAULT_BASE_PRICES, mow: 40 },
          parcel_field_map: { parcel_id: { field: "parcelpin", source: "auto", candidates: ["parcelpin"] } } as never,
        }),
      ],
    });
    const s = await updateCanvassSettings(db, {
      base_prices: { snow: 60 },
      season_map: { "3": "mow" },
      parcel_field_map: { owner: { field: "deeded_owner", source: "manual", candidates: ["deeded_owner", "owner"] } },
    });
    expect(s.base_prices).toEqual({ ...DEFAULT_BASE_PRICES, mow: 40, snow: 60 });
    expect(s.season_map).toEqual({ ...DEFAULT_SEASON_MAP, "3": "mow" });
    expect(s.parcel_field_map.parcel_id?.field).toBe("parcelpin");
    expect(s.parcel_field_map.owner?.field).toBe("deeded_owner");
    const stored = db.tables.canvass_settings[0];
    expect(stored.base_prices).toEqual({ ...DEFAULT_BASE_PRICES, mow: 40, snow: 60 });
    expect(stored.updated_at).not.toBe(T0);
  });
  it("an empty patch reads the row without writing", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const s = await updateCanvassSettings(db, {});
    expect(s.updated_at).toBe(T0);
  });
});
