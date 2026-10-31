import { describe, expect, it } from "vitest";
import type { KnockOutcome } from "../db/types";
import { NO_PITCH_NAME, isAnswer, isClose, isQuote, knockStats, percent, totalKnockStats } from "./stats";

const k = (knocker_id: string, pitch_id: string | null, outcome: KnockOutcome) => ({ knocker_id, pitch_id, outcome });

const names = {
  knockers: new Map([
    ["a", "Emmett"],
    ["b", "Sam"],
  ]),
  pitches: new Map([
    ["p1", "Neighbor special"],
    ["p2", "Season focus"],
  ]),
};

describe("knock stats", () => {
  const knocks = [
    k("a", "p1", "no_answer"),
    k("a", "p1", "no_answer"),
    k("a", "p1", "not_interested"),
    k("a", "p1", "quote_given"),
    k("a", "p2", "booked"),
    k("a", "p2", "call_back"),
    k("b", "p2", "no_answer"),
    k("b", null, "has_service"),
    k("b", null, "no_soliciting"),
    k("b", null, "booked"),
    k("c", "p9", "do_not_return"),
  ];

  it("classifies outcomes", () => {
    expect(isAnswer("no_answer")).toBe(false);
    for (const o of ["not_interested", "quote_given", "booked", "call_back", "no_soliciting", "do_not_return", "has_service"] as const) {
      expect(isAnswer(o)).toBe(true);
    }
    expect(isQuote("quote_given")).toBe(true);
    expect(isQuote("booked")).toBe(false);
    expect(isClose("booked")).toBe(true);
    expect(isClose("quote_given")).toBe(false);
  });

  it("counts knocks, answers, quotes and closes per knocker, most knocks first", () => {
    const { byKnocker } = knockStats(knocks, names);
    expect(byKnocker.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(byKnocker[0]).toEqual({
      id: "a",
      name: "Emmett",
      knocks: 6,
      answers: 4,
      answerRate: 4 / 6,
      quotes: 1,
      closes: 1,
      closeRate: 1 / 4,
    });
    expect(byKnocker[1]).toEqual({ id: "b", name: "Sam", knocks: 4, answers: 3, answerRate: 3 / 4, quotes: 0, closes: 1, closeRate: 1 / 3 });
    // a knocker whose profile is gone still shows, under a short id
    expect(byKnocker[2]).toMatchObject({ id: "c", name: "c", knocks: 1, answers: 1, answerRate: 1, closes: 0, closeRate: 0 });
  });

  it("counts per pitch, with knocks logged without a pitch grouped under 'No pitch'", () => {
    const { byPitch } = knockStats(knocks, names);
    // p2 and "No pitch" tie on knocks, so they sort by name
    expect(byPitch.map((r) => r.id)).toEqual(["p1", null, "p2", "p9"]);
    expect(byPitch[0]).toEqual({
      id: "p1",
      name: "Neighbor special",
      knocks: 4,
      answers: 2,
      answerRate: 0.5,
      quotes: 1,
      closes: 0,
      closeRate: 0,
    });
    expect(byPitch[2]).toMatchObject({ id: "p2", name: "Season focus", knocks: 3, answers: 2, closes: 1, closeRate: 0.5 });
    expect(byPitch[1]).toMatchObject({ id: null, name: NO_PITCH_NAME, knocks: 3, answers: 3, closes: 1 });
    expect(byPitch[3].name).toBe("p9");
  });

  it("uses null rates (not 0) when there is no sample", () => {
    expect(knockStats([], names)).toEqual({ byKnocker: [], byPitch: [] });
    const { byKnocker } = knockStats([k("a", null, "no_answer")], names);
    expect(byKnocker[0]).toMatchObject({ knocks: 1, answers: 0, answerRate: 0, closes: 0, closeRate: null });
  });

  it("totals rows and formats percentages", () => {
    const { byKnocker } = knockStats(knocks, names);
    expect(totalKnockStats(byKnocker)).toEqual({ knocks: 11, answers: 8, answerRate: 8 / 11, quotes: 1, closes: 2, closeRate: 0.25 });
    expect(totalKnockStats([])).toEqual({ knocks: 0, answers: 0, answerRate: null, quotes: 0, closes: 0, closeRate: null });
    expect(percent(0.25)).toBe("25%");
    expect(percent(null)).toBe("—");
  });

  it("truncates long ids used as names", () => {
    const { byKnocker } = knockStats([k("0123456789abcdef", null, "booked")], names);
    expect(byKnocker[0].name).toBe("01234567…");
  });
});
