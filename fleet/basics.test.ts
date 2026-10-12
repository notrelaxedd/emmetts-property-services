import { describe, expect, it } from "vitest";
import type { FleetTaskType } from "../lib/db/types";
import { taskRoleFor } from "../lib/ops/tasks";
import { backoffInterval, backoffMinutes } from "./backoff";
import { parseEnv } from "./env";
import { PermanentTaskError } from "./errors";
import { readTemp, resolveVersion } from "./heartbeat";
import { formatLine } from "./log";
import { dispatch, TASKS, typesForRole } from "./tasks/index";
import { payloadSchemas } from "./tasks/schemas";
import { fleetDb, makeCtx } from "./test-helpers";
import { isoWeek, seasonOf, weatherDedupeKey, weeklyAdsDue, yyyymmdd } from "./time";

const ID = "7d3c9f8e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";
const ALL_TYPES: FleetTaskType[] = [
  "quote", "schedule", "ad_draft", "followup_review", "followup_reminder", "weather_watch", "send_message", "custom_summary",
];

describe("backoff", () => {
  it("is min(2^attempts, 60) minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 10].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
    expect(backoffMinutes(-3)).toBe(1);
    expect(backoffMinutes(Number.NaN)).toBe(1);
    expect(backoffInterval(3)).toBe("8 minutes");
  });
});

describe("payload schemas", () => {
  it("accept good payloads and keep extra keys", () => {
    expect(payloadSchemas.quote.parse({ lead_id: ID, from: "form" })).toEqual({ lead_id: ID, from: "form" });
    expect(payloadSchemas.schedule.parse({ reason: "job_paid", job_ids: [ID] })).toEqual({ reason: "job_paid", job_ids: [ID] });
    expect(payloadSchemas.schedule.parse({})).toEqual({ reason: "sweep" });
    expect(payloadSchemas.ad_draft.parse({ channel: "nextdoor", season: "fall", offer: "Fall lawn cleanup" }).channel).toBe("nextdoor");
    expect(payloadSchemas.weather_watch.parse({})).toEqual({});
    expect(payloadSchemas.send_message.parse({ message_id: "00000000-0000-0000-0000-000000000001" }).message_id).toBeTruthy();
  });
  it("reject bad payloads", () => {
    expect(payloadSchemas.quote.safeParse({}).success).toBe(false);
    expect(payloadSchemas.quote.safeParse({ lead_id: "nope" }).success).toBe(false);
    expect(payloadSchemas.schedule.safeParse({ reason: "x", job_ids: ["nope"] }).success).toBe(false);
    expect(payloadSchemas.ad_draft.safeParse({ channel: "tiktok", season: "fall", offer: "x" }).success).toBe(false);
    expect(payloadSchemas.followup_review.safeParse({ job: ID }).success).toBe(false);
  });
});

describe("dispatch table", () => {
  it("has an entry for every task type, on the role taskRoleFor says", () => {
    expect(Object.keys(TASKS).sort()).toEqual([...ALL_TYPES].sort());
    for (const t of ALL_TYPES) expect(TASKS[t].role).toBe(taskRoleFor(t));
  });
  it("maps roles to task types; host claims nothing", () => {
    expect(typesForRole("quotes").sort()).toEqual(["custom_summary", "quote"]);
    expect(typesForRole("scheduler")).toEqual(["schedule"]);
    expect(typesForRole("ads")).toEqual(["ad_draft"]);
    expect(typesForRole("followup").sort()).toEqual(["followup_reminder", "followup_review", "send_message", "weather_watch"]);
    expect(typesForRole("host")).toEqual([]);
  });
  it("fails permanently on a bad payload or unknown type, before running anything", async () => {
    const ctx = makeCtx(fleetDb());
    await expect(dispatch(ctx, { id: ID, type: "quote", payload: { lead: 1 } })).rejects.toBeInstanceOf(PermanentTaskError);
    await expect(dispatch(ctx, { id: ID, type: "nope" as FleetTaskType, payload: {} })).rejects.toThrow(/no handler/);
  });
  it("runs the task with the parsed payload", async () => {
    const db = fleetDb({ messages: [], customers: [] });
    const ctx = makeCtx(db);
    // send_message for a missing message: lib/email throws, which is a retryable (not permanent) error.
    const err = await dispatch(ctx, { id: ID, type: "send_message", payload: { message_id: ID } }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentTaskError);
    expect(String(err.message)).toMatch(/not found/);
  });
});

describe("time helpers (America/New_York)", () => {
  it("isoWeek", () => {
    expect(isoWeek("2026-10-12")).toBe("2026-W42");
    expect(isoWeek("2026-10-18")).toBe("2026-W42"); // Sunday belongs to the Monday's week
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
  });
  it("season, yyyymmdd and the 6-hour weather key use local time", () => {
    expect(seasonOf(new Date("2026-10-12T14:00:00Z"))).toBe("fall");
    expect(seasonOf(new Date("2026-12-01T14:00:00Z"))).toBe("winter");
    expect(seasonOf(new Date("2026-04-01T14:00:00Z"))).toBe("spring");
    expect(seasonOf(new Date("2026-07-01T14:00:00Z"))).toBe("summer");
    expect(yyyymmdd(new Date("2026-10-13T02:00:00Z"))).toBe("20261012"); // 10pm EDT on the 12th
    expect(weatherDedupeKey(new Date("2026-10-12T14:00:00Z"))).toBe("weather:2026-10-12-1"); // 10am EDT
    expect(weatherDedupeKey(new Date("2026-10-13T03:59:00Z"))).toBe("weather:2026-10-12-3"); // 11:59pm EDT
  });
  it("weekly ads are due from Monday 7am ET", () => {
    expect(weeklyAdsDue(new Date("2026-10-12T10:59:00Z"))).toBe(false); // Mon 6:59am EDT
    expect(weeklyAdsDue(new Date("2026-10-12T11:00:00Z"))).toBe(true); // Mon 7:00am EDT
    expect(weeklyAdsDue(new Date("2026-10-14T03:00:00Z"))).toBe(true); // Tue
  });
});

describe("env, logs, metrics", () => {
  const base = { FLEET_ROLE: "quotes", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
  it("parses env with defaults and rejects a bad role", () => {
    const e = parseEnv({ ...base, SITE_URL: "https://eod.test/" });
    expect(e.role).toBe("quotes");
    expect(e.name).toMatch(/^quotes-/);
    expect(e.siteUrl).toBe("https://eod.test");
    expect(parseEnv({ ...base, FLEET_NAME: "W2" }).name).toBe("W2");
    expect(() => parseEnv({ ...base, FLEET_ROLE: "boss" })).toThrow(/FLEET_ROLE/);
    expect(() => parseEnv({ FLEET_ROLE: "host" })).toThrow(/SUPABASE_URL/);
  });
  it("formats compact single lines", () => {
    expect(formatLine("INFO", "done", { task: "quote", ms: 12, err: "a b\nc", skip: undefined })).toBe('INFO done task=quote ms=12 err="a b c"');
  });
  it("reads temperature as null when unreadable and versions from env first", () => {
    expect(readTemp("/definitely/not/here")).toBeNull();
    expect(resolveVersion("/nonexistent", { GIT_SHA: "abc1234" })).toBe("abc1234");
    expect(resolveVersion("/nonexistent", {})).toBeNull();
  });
});
