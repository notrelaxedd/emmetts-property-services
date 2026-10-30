import { describe, expect, it } from "vitest";
import type { Knock } from "../db/types";
import { fakeDb } from "../ops/test-utils";
import { knockRow } from "./rows.fixture";
import { dayBounds, digestFromRows, type DigestKnockRow, emptySummary, knockBucketLabel, storeCanvassSummary, weatherLabel, weekdayName, windowsByStreet, yesterdayLocal } from "./summary";

const names = { knockerNames: new Map([["k1", "Emmett"], ["k2", "Sam"]]), pitchNames: new Map([["p1", "Neighbor special"]]) };

describe("digestFromRows", () => {
  it("aggregates by outcome, street, knocker, pitch and time bucket, with rates and weather", () => {
    const at = (h: number) => `2026-10-29T${String(h + 4).padStart(2, "0")}:30:00.000Z`; // Ohio hour h on Thu Oct 29 (EDT)
    const row = (street: string, knocker_id: string, pitch_id: string | null, outcome: Knock["outcome"], hour: number, weather: Knock["weather"] = null): DigestKnockRow => ({
      ...knockRow({ knocker_id, pitch_id, outcome, knocked_at: at(hour), weather }),
      street,
    });
    const overcast = (temp_f: number) => ({ temp_f, precip_in: 0, code: 3, label: "Overcast" });
    const knocks = [
      row("ELM ST", "k1", "p1", "no_answer", 16, overcast(52.4)),
      row("ELM ST", "k1", "p1", "booked", 17, overcast(51.6)),
      row("Elm St", "k2", null, "call_back", 18),
      row("OAK AVE", "k2", "p1", "no_soliciting", 18),
      row("OAK AVE", "k2", "p1", "quote_given", 19),
    ];
    const d = digestFromRows({ forDate: "2026-10-29", knocks, ...names, windowsByStreet: new Map([["ELM ST", "Weekdays 4–6pm likely"]]), hangerScans: 3, season: "Leaf cleanup" });

    expect(d.weekday).toBe("Thursday");
    expect(d.season).toBe("Leaf cleanup");
    expect(d.totals).toEqual({ knocks: 5, answers: 4, quotes: 1, booked: 1, callbacks: 1, doNotKnock: 1, answerRate: 0.8, closeRate: 0.25 });
    expect(d.byOutcome.no_answer).toBe(1);
    expect(d.byOutcome.booked).toBe(1);
    expect(d.byOutcome.has_service).toBe(0);
    expect(d.byStreet).toEqual([
      { name: "ELM ST", knocks: 3, answers: 2, quotes: 0, booked: 1, callbacks: 1, doNotKnock: 0, window: "Weekdays 4–6pm likely" },
      { name: "OAK AVE", knocks: 2, answers: 2, quotes: 1, booked: 0, callbacks: 0, doNotKnock: 1, window: null },
    ]);
    expect(d.byKnocker.map((k) => [k.name, k.knocks])).toEqual([
      ["Sam", 3],
      ["Emmett", 2],
    ]);
    expect(d.byPitch.map((p) => [p.name, p.knocks])).toEqual([
      ["Neighbor special", 4],
      ["No pitch", 1],
    ]);
    expect(d.byHour).toEqual([
      { bucket: "Weekdays 4–6pm", knocks: 2, answers: 1 },
      { bucket: "Weekdays 6–8pm", knocks: 3, answers: 3 },
    ]);
    expect(d.weather).toEqual(["52°F, Overcast"]);
    expect(d.hangerScans).toBe(3);
    // Nothing personal leaves the digest.
    expect(JSON.stringify(d)).not.toMatch(/notes|callback_window|owner/);
  });

  it("an empty day gives zero totals and null rates", () => {
    const d = digestFromRows({ forDate: "2026-10-29", knocks: [], ...names });
    expect(d.totals.knocks).toBe(0);
    expect(d.totals.answerRate).toBeNull();
    expect(d.byStreet).toEqual([]);
    expect(d.weather).toEqual([]);
  });
});

describe("helpers", () => {
  it("labels buckets, weather and weekdays", () => {
    expect(knockBucketLabel("2026-10-31T15:10:00.000Z")).toBe("Weekends 10am–12pm"); // Sat 11:10am EDT
    expect(knockBucketLabel("2026-10-29T06:00:00.000Z")).toBe("Off hours"); // 2am
    expect(weatherLabel(null)).toBeNull();
    expect(weatherLabel({ temp_f: 40.2, precip_in: 0.1, code: 61, label: "Light rain" })).toBe("40°F, Light rain, 0.10 in precip");
    expect(weekdayName("2026-10-29")).toBe("Thursday");
    expect(weekdayName("junk")).toBe("");
  });
  it("emptySummary names the date and has every field", () => {
    const s = emptySummary("2026-10-29");
    expect(s.headline).toBe("No knocks on 2026-10-29");
    expect(Object.keys(s).sort()).toEqual(["best_streets", "headline", "highlights", "knocker_notes", "pitch_notes", "tomorrow", "worst_streets"]);
  });
  it("yesterdayLocal / dayBounds use Ohio time", () => {
    expect(yesterdayLocal(new Date("2026-10-30T03:30:00.000Z"))).toBe("2026-10-28"); // still Oct 29 at 11:30pm in Ohio
    expect(yesterdayLocal(new Date("2026-10-30T12:00:00.000Z"))).toBe("2026-10-29");
    expect(dayBounds("2026-10-29")).toEqual({ start: "2026-10-29T04:00:00.000Z", end: "2026-10-30T04:00:00.000Z" });
  });
  it("windowsByStreet picks the most common label and skips do-not-knock houses", () => {
    const w = windowsByStreet([
      { street: "Elm St", window: { label: "A" }, do_not_knock: false },
      { street: "ELM ST", window: { label: "B" }, do_not_knock: false },
      { street: "ELM ST", window: { label: "B" }, do_not_knock: false },
      { street: "OAK AVE", window: { label: "Do not knock" }, do_not_knock: true },
    ]);
    expect(w.get("ELM ST")).toBe("B");
    expect(w.has("OAK AVE")).toBe(false);
  });
  it("windowsByStreet never passes a homeowner's or crew's per-house label to the digest", () => {
    const w = windowsByStreet([
      { street: "ELM RD", window: { label: "Homeowner: Ask for Maria, she works at the clinic", source: "homeowner" }, do_not_knock: false },
      { street: "ELM RD", window: { label: "Homeowner: call 555-0100", source: "homeowner" }, do_not_knock: false },
      { street: "ELM RD", window: { label: "Weekends likely", source: "crew" }, do_not_knock: false },
      { street: "ELM RD", window: { label: "Weekdays 4–6pm likely", source: "acs" }, do_not_knock: false },
      { street: "OAK AVE", window: { label: "Homeowner: Ask for Maria", source: "homeowner" }, do_not_knock: false },
    ]);
    expect(w.get("ELM RD")).toBe("Weekdays 4–6pm likely");
    expect(w.has("OAK AVE")).toBe(false);
    const d = digestFromRows({ forDate: "2026-10-29", knocks: [], knockerNames: new Map(), pitchNames: new Map(), windowsByStreet: w, season: "Leaf cleanup" });
    expect(JSON.stringify(d)).not.toContain("Homeowner:");
  });
  it("storeCanvassSummary inserts once and replaces on re-run", async () => {
    const db = fakeDb();
    await storeCanvassSummary(db, "2026-10-29", emptySummary("2026-10-29"), null);
    await storeCanvassSummary(db, "2026-10-29", { ...emptySummary("2026-10-29"), headline: "31 doors" }, "claude-sonnet-5-5");
    expect(db.tables.canvass_summaries).toHaveLength(1);
    expect((db.tables.canvass_summaries[0].summary as { headline: string }).headline).toBe("31 doors");
    expect(db.tables.canvass_summaries[0].model).toBe("claude-sonnet-5-5");
  });
});
