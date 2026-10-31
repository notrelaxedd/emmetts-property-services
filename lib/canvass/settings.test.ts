import { describe, expect, it } from "vitest";
import { CANVASS_SETTINGS_ID } from "../db/types";
import type { CanvassSettings } from "../db/types";
import { fakeDb } from "../ops/test-utils";
import { canvassSettingsRow as fixtureRow } from "./rows.fixture";
import {
  DEFAULT_PRICE_TIERS,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_SEASON_MAP,
  DEFAULT_TIER_BOUNDS,
  DEFAULT_TIER_MINUTES,
  getCanvassSettings,
  mergeParcelFieldMap,
  mergePriceTiers,
  mergeScoreWeights,
  mergeSeasonMap,
  mergeTierBounds,
  mergeTierMinutes,
  updateCanvassSettings,
} from "./settings";
import { PARCEL_FIELD_KEYS, emptyParcelFieldMap } from "./types";

const T0 = "2026-01-01T00:00:00.000Z";
const NULLS = { small: null, medium: null, large: null, xl: null };

/** A row exactly as the migration seeds it (the shared fixture mirrors the column defaults). */
const canvassSettingsRow = (over: Partial<CanvassSettings> = {}): CanvassSettings =>
  // The column default `{}` is a patch, not a full map: getCanvassSettings fills every key.
  fixtureRow({ parcel_field_map: {} as never, ...over });

describe("defaults", () => {
  it("DEFAULT_PRICE_TIERS / TIER_MINUTES / TIER_BOUNDS / SCORE_WEIGHTS mirror the migration column defaults", () => {
    expect(DEFAULT_PRICE_TIERS).toEqual({
      leaf_cleanup: { small: 30, medium: 40, large: 50, xl: null },
      mow: NULLS,
      edge: NULLS,
      gutters: NULLS,
      snow: NULLS,
    });
    expect(DEFAULT_TIER_MINUTES).toEqual({ leaf_cleanup: NULLS, mow: NULLS, edge: NULLS, gutters: NULLS, snow: NULLS });
    expect(DEFAULT_TIER_BOUNDS).toEqual({ small_max: 4000, medium_max: 8000, large_max: 12000 });
    expect(DEFAULT_SCORE_WEIGHTS).toEqual({ lawn: 1, customer: 1, owner: 1 });
  });
  it("DEFAULT_SEASON_MAP mirrors the migration column default", () => {
    expect(Object.keys(DEFAULT_SEASON_MAP)).toHaveLength(12);
    expect(DEFAULT_SEASON_MAP["1"]).toBe("snow");
    expect(DEFAULT_SEASON_MAP["4"]).toBe("mow");
    expect(DEFAULT_SEASON_MAP["9"]).toBe("leaf_cleanup");
    expect(DEFAULT_SEASON_MAP["12"]).toBe("snow");
  });
});

describe("merge helpers", () => {
  it("mergePriceTiers fills missing / bad cells from the defaults and applies a patch cell by cell", () => {
    expect(mergePriceTiers(null)).toEqual(DEFAULT_PRICE_TIERS);
    expect(mergePriceTiers([1, 2])).toEqual(DEFAULT_PRICE_TIERS);
    expect(mergePriceTiers({ leaf_cleanup: "x", mow: [] })).toEqual(DEFAULT_PRICE_TIERS);
    const stored = { mow: { small: 35, medium: "x", large: -1, xl: Number.NaN } };
    expect(mergePriceTiers(stored).mow).toEqual({ small: 35, medium: null, large: null, xl: null });
    const merged = mergePriceTiers({ mow: { small: 35 } }, { mow: { medium: 45 }, edge: { xl: 99 } });
    expect(merged.mow).toEqual({ small: 35, medium: 45, large: null, xl: null });
    expect(merged.edge).toEqual({ small: null, medium: null, large: null, xl: 99 });
    expect(merged.leaf_cleanup).toEqual(DEFAULT_PRICE_TIERS.leaf_cleanup);
  });
  it("an explicit null clears a price or minutes cell (back to 'owner to fill in' / unknown)", () => {
    const cleared = mergePriceTiers(DEFAULT_PRICE_TIERS, { leaf_cleanup: { medium: null } });
    expect(cleared.leaf_cleanup).toEqual({ small: 30, medium: null, large: 50, xl: null });
    // a stored null stays null even though the default is a number
    expect(mergePriceTiers({ leaf_cleanup: { small: null, medium: 40, large: 50, xl: null } }).leaf_cleanup.small).toBeNull();
    expect(mergeTierMinutes({ mow: { small: 20 } }, { mow: { small: null } }).mow.small).toBeNull();
  });
  it("mergeTierMinutes defaults to all-unknown and accepts zero", () => {
    expect(mergeTierMinutes(undefined)).toEqual(DEFAULT_TIER_MINUTES);
    const m = mergeTierMinutes({ snow: { small: 0, medium: 30 } }, { snow: { large: 45.5 } });
    expect(m.snow).toEqual({ small: 0, medium: 30, large: 45.5, xl: null });
  });
  it("mergeTierBounds keeps valid bounds, ignores a patch that breaks the order, repairs junk", () => {
    expect(mergeTierBounds(null)).toEqual(DEFAULT_TIER_BOUNDS);
    expect(mergeTierBounds({ small_max: 3000, medium_max: 6000, large_max: 9000 })).toEqual({ small_max: 3000, medium_max: 6000, large_max: 9000 });
    expect(mergeTierBounds(DEFAULT_TIER_BOUNDS, { medium_max: 9000 })).toEqual({ small_max: 4000, medium_max: 9000, large_max: 12000 });
    expect(mergeTierBounds(DEFAULT_TIER_BOUNDS, { medium_max: 13000 })).toEqual(DEFAULT_TIER_BOUNDS);
    expect(mergeTierBounds(DEFAULT_TIER_BOUNDS, { small_max: 0 })).toEqual(DEFAULT_TIER_BOUNDS);
    expect(mergeTierBounds({ small_max: 9000, medium_max: 5000, large_max: "x" })).toEqual(DEFAULT_TIER_BOUNDS);
    expect(mergeTierBounds([1])).toEqual(DEFAULT_TIER_BOUNDS);
  });
  it("mergeScoreWeights fills from the defaults and drops bad values", () => {
    expect(mergeScoreWeights(null)).toEqual(DEFAULT_SCORE_WEIGHTS);
    expect(mergeScoreWeights({ time: 2, lawn: "x", customer: -1, owner: 0 })).toEqual({ lawn: 1, customer: 1, owner: 0 }); // a stored time key is ignored
    expect(mergeScoreWeights({ customer: 2 }, { lawn: 3 })).toEqual({ lawn: 3, customer: 2, owner: 1 });
    expect(mergeScoreWeights({ time: 99 })).toEqual(DEFAULT_SCORE_WEIGHTS);
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
      canvass_settings: [
        canvassSettingsRow({
          price_tiers: { mow: { medium: 45 } } as never,
          tier_bounds: {} as never,
          tier_minutes: null as never,
          score_weights: { lawn: 2 } as never,
          season_map: {} as never,
        }),
      ],
    });
    const s = await getCanvassSettings(db);
    expect(s.id).toBe(CANVASS_SETTINGS_ID);
    expect(s.price_tiers.mow).toEqual({ small: null, medium: 45, large: null, xl: null });
    expect(s.price_tiers.leaf_cleanup).toEqual(DEFAULT_PRICE_TIERS.leaf_cleanup);
    expect(s.tier_bounds).toEqual(DEFAULT_TIER_BOUNDS);
    expect(s.tier_minutes).toEqual(DEFAULT_TIER_MINUTES);
    expect(s.score_weights).toEqual({ ...DEFAULT_SCORE_WEIGHTS, lawn: 2 });
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
    const s = await updateCanvassSettings(db, { doors_per_hour: 30, offer_text: "Fall special", crew_size: 4, pay_rate: 18, walk_doors: 40 });
    expect(s.doors_per_hour).toBe(30);
    expect(s.offer_text).toBe("Fall special");
    expect(s).toMatchObject({ crew_size: 4, pay_rate: 18, walk_doors: 40 });
    expect(s.price_tiers).toEqual(DEFAULT_PRICE_TIERS);
    expect(db.tables.canvass_settings[0].doors_per_hour).toBe(30);
    expect(db.tables.canvass_settings[0].crew_size).toBe(4);
  });
  it("merges the tier tables / bounds / weights / season map / parcel_field_map per key instead of replacing them", async () => {
    const db = fakeDb({
      canvass_settings: [
        canvassSettingsRow({
          price_tiers: { ...DEFAULT_PRICE_TIERS, mow: { small: 35, medium: 45, large: null, xl: null } },
          parcel_field_map: { parcel_id: { field: "parcelpin", source: "auto", candidates: ["parcelpin"] } } as never,
        }),
      ],
    });
    const s = await updateCanvassSettings(db, {
      price_tiers: { mow: { large: 60 }, snow: { small: 80 } },
      tier_minutes: { leaf_cleanup: { medium: 30 } },
      tier_bounds: { small_max: 3500 },
      score_weights: { customer: 2 },
      season_map: { "3": "mow" },
      parcel_field_map: { owner: { field: "deeded_owner", source: "manual", candidates: ["deeded_owner", "owner"] } },
    });
    expect(s.price_tiers.mow).toEqual({ small: 35, medium: 45, large: 60, xl: null });
    expect(s.price_tiers.snow.small).toBe(80);
    expect(s.price_tiers.leaf_cleanup).toEqual(DEFAULT_PRICE_TIERS.leaf_cleanup);
    expect(s.tier_minutes.leaf_cleanup).toEqual({ small: null, medium: 30, large: null, xl: null });
    expect(s.tier_bounds).toEqual({ small_max: 3500, medium_max: 8000, large_max: 12000 });
    expect(s.score_weights).toEqual({ ...DEFAULT_SCORE_WEIGHTS, customer: 2 });
    expect(s.season_map).toEqual({ ...DEFAULT_SEASON_MAP, "3": "mow" });
    expect(s.parcel_field_map.parcel_id?.field).toBe("parcelpin");
    expect(s.parcel_field_map.owner?.field).toBe("deeded_owner");
    const stored = db.tables.canvass_settings[0];
    expect(stored.price_tiers).toEqual({ ...DEFAULT_PRICE_TIERS, mow: { small: 35, medium: 45, large: 60, xl: null }, snow: { small: 80, medium: null, large: null, xl: null } });
    expect(stored.tier_bounds).toEqual({ small_max: 3500, medium_max: 8000, large_max: 12000 });
    expect(stored.updated_at).not.toBe(T0);
  });
  it("clearing a price in a patch stores null", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const s = await updateCanvassSettings(db, { price_tiers: { leaf_cleanup: { medium: null } } });
    expect(s.price_tiers.leaf_cleanup.medium).toBeNull();
    expect((db.tables.canvass_settings[0].price_tiers as CanvassSettings["price_tiers"]).leaf_cleanup.medium).toBeNull();
  });
  it("an empty patch reads the row without writing", async () => {
    const db = fakeDb({ canvass_settings: [canvassSettingsRow()] });
    const s = await updateCanvassSettings(db, {});
    expect(s.updated_at).toBe(T0);
  });
});
