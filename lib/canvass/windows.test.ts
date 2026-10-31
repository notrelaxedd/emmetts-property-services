import { describe, expect, it } from "vitest";
import type { Knock } from "../db/types";
import type { PriorWindow, TimeWindow } from "./types";
import {
  acsPrior,
  answerProbability,
  bucketOf,
  bucketRange,
  emptyPrior,
  formatHourRange,
  formatWindow,
  learnedBucketAt,
  learnedWindow,
  parseStatedWindow,
  priorHasData,
  resolveWindow,
} from "./windows";

const SETTINGS = {
  daytime_not_in_lf_threshold: 0.4,
  daytime_nonworking_parent_threshold: 0.35,
  work_hours: 8.5,
  learned_min_knocks: 8,
};

const range = (days: TimeWindow["days"], start: number, end: number): TimeWindow => ({ kind: "range", days, start, end });

describe("bucketRange", () => {
  it("snaps onto even 2-hour buckets", () => {
    expect(bucketRange(17, 19)).toEqual({ start: 16, end: 20 });
    expect(bucketRange(16.5, 17.2)).toEqual({ start: 16, end: 18 });
    expect(bucketRange(6, 8)).toEqual({ start: 6, end: 8 });
  });
  it("is never narrower than 2 hours and stays inside the day", () => {
    expect(bucketRange(16, 16)).toEqual({ start: 16, end: 18 });
    expect(bucketRange(23, 25)).toEqual({ start: 22, end: 24 });
    expect(bucketRange(-3, 1)).toEqual({ start: 0, end: 2 });
  });
});

describe("formatWindow", () => {
  it("uses an en dash and one am/pm suffix when both ends share it", () => {
    expect(formatWindow(range("weekdays", 16, 18))).toBe("Weekdays 4–6pm likely");
    expect(formatWindow(range("weekends", 10, 12))).toBe("Weekends 10am–12pm likely");
    expect(formatWindow(range("any", 8, 12))).toBe("Any day 8am–12pm likely");
    expect(formatHourRange(22, 24)).toBe("10pm–12am");
    expect(formatHourRange(12, 14)).toBe("12–2pm");
  });
  it("labels anytime windows", () => {
    expect(formatWindow({ kind: "anytime", days: "weekdays" })).toBe("Anytime weekdays");
    expect(formatWindow({ kind: "anytime", days: "weekends" })).toBe("Anytime weekends");
    expect(formatWindow({ kind: "anytime", days: "any" })).toBe("Anytime");
  });
  it("accepts another suffix", () => {
    expect(formatWindow(range("weekdays", 17, 21), "(homeowner)")).toBe("Weekdays 5–9pm (homeowner)");
    expect(formatWindow(range("weekdays", 17, 19), "")).toBe("Weekdays 5–7pm");
  });
});

describe("parseStatedWindow", () => {
  it("reads 'weekdays after 5' as weekdays 17–21", () => {
    const r = parseStatedWindow("weekdays after 5");
    expect(r.parsed).toBe(true);
    expect(r.window).toEqual(range("weekdays", 17, 21));
    expect(r.label).toBe("Weekdays 5–9pm (homeowner)");
  });
  it("reads bare hours in the afternoon and leaves days open", () => {
    expect(parseStatedWindow("after 6").window).toEqual(range("any", 18, 22));
    expect(parseStatedWindow("After 5:30pm").window).toEqual(range("any", 17, 21));
  });
  it("reads day parts", () => {
    expect(parseStatedWindow("evenings").window).toEqual(range("any", 17, 21));
    expect(parseStatedWindow("mornings").window).toEqual(range("any", 8, 12));
    expect(parseStatedWindow("sat morning").window).toEqual(range("weekends", 8, 12));
    expect(parseStatedWindow("before noon").window).toEqual(range("any", 8, 12));
    expect(parseStatedWindow("lunch").window).toEqual(range("any", 12, 14));
    expect(parseStatedWindow("weekday afternoons").window).toEqual(range("weekdays", 12, 17));
  });
  it("reads explicit ranges", () => {
    expect(parseStatedWindow("4-6pm").window).toEqual(range("any", 16, 18));
    expect(parseStatedWindow("between 4 and 6 on weekends").window).toEqual(range("weekends", 16, 18));
    expect(parseStatedWindow("Sat 10am to 2pm").window).toEqual(range("weekends", 10, 14));
  });
  it("reads day-only answers as anytime on those days", () => {
    expect(parseStatedWindow("any time sat")).toEqual({
      window: { kind: "anytime", days: "weekends" },
      label: "Anytime weekends (homeowner)",
      parsed: true,
    });
    expect(parseStatedWindow("weekends").window).toEqual({ kind: "anytime", days: "weekends" });
    expect(parseStatedWindow("weekdays").window).toEqual({ kind: "anytime", days: "weekdays" });
  });
  it("keeps the raw words when it cannot read them", () => {
    const r = parseStatedWindow("ask for Dave");
    expect(r).toEqual({ window: { kind: "anytime", days: "any" }, label: "Homeowner: ask for Dave", parsed: false });
    // "am" inside a sentence is not a morning.
    expect(parseStatedWindow("I am home evenings").window).toEqual(range("any", 17, 21));
  });
});

describe("acsPrior", () => {
  it("is daytime-friendly when many adults are not in the labor force, with a ~% reason", () => {
    const p = acsPrior({ pct_not_in_lf: 0.4, pct_hh_nonworking_parent: 0.1, typicalDepart: 7.5, typicalCommute: 25 }, SETTINGS);
    expect(p.daytimeFriendly).toBe(true);
    expect(p.window).toEqual(range("weekdays", 10, 16));
    expect(p.reason).toBe("Area: ~40% of households have a non-working adult → daytime OK.");
    expect(p.pctNotInLf).toBe(0.4);
    expect(p.typicalCommute).toBe(25);
  });
  it("is daytime-friendly on the non-working-parent threshold too", () => {
    const p = acsPrior({ pct_not_in_lf: 0.2, pct_hh_nonworking_parent: 0.36, typicalDepart: 8, typicalCommute: 20 }, SETTINGS);
    expect(p.daytimeFriendly).toBe(true);
    expect(p.reason).toContain("~36%");
    expect(p.reason).toContain("daytime OK");
  });
  it("rounds 7:30am + 25 min + 8.5h (+ 25 min back) into the 4–6pm bucket", () => {
    const p = acsPrior({ pct_not_in_lf: 0.25, pct_hh_nonworking_parent: 0.1, typicalDepart: 7.5, typicalCommute: 25 }, SETTINGS);
    expect(p.daytimeFriendly).toBe(false);
    expect(p.window).toEqual(range("weekdays", 16, 18));
    expect(formatWindow(p.window)).toBe("Weekdays 4–6pm likely");
    expect(p.reason).toBe("Area: typical departure ~7:30am + ~25 min commute + 8.5h → home ~5:00pm");
  });
  it("clamps the return-home bucket to 3–9pm", () => {
    const early = acsPrior({ pct_not_in_lf: 0.2, pct_hh_nonworking_parent: 0.1, typicalDepart: 5, typicalCommute: 10 }, SETTINGS);
    expect(early.window).toEqual(range("weekdays", 15, 17));
    const late = acsPrior({ pct_not_in_lf: 0.2, pct_hh_nonworking_parent: 0.1, typicalDepart: 11, typicalCommute: 45 }, SETTINGS);
    expect(late.window).toEqual(range("weekdays", 19, 21));
    const mid = acsPrior({ pct_not_in_lf: 0.2, pct_hh_nonworking_parent: 0.1, typicalDepart: 8.5, typicalCommute: 30 }, SETTINGS);
    expect(mid.window).toEqual(range("weekdays", 18, 20));
  });
  it("falls back to the default evening bucket without any numbers", () => {
    expect(acsPrior(null, SETTINGS)).toEqual(emptyPrior());
    const none = acsPrior({ pct_not_in_lf: null, pct_hh_nonworking_parent: null, typicalDepart: null, typicalCommute: null }, SETTINGS);
    expect(none.window).toEqual(range("weekdays", 17, 19));
    expect(none.reason).toBe("No area data yet");
    expect(priorHasData(none)).toBe(false);
    const working = acsPrior({ pct_not_in_lf: 0.2, pct_hh_nonworking_parent: null, typicalDepart: null, typicalCommute: null }, SETTINGS);
    expect(working.window).toEqual(range("weekdays", 17, 19));
    expect(priorHasData(working)).toBe(true);
  });
});

describe("bucketOf", () => {
  it("uses the local weekday and hour in America/New_York", () => {
    // 2026-07-09 is a Thursday; 20:30Z is 16:30 EDT.
    const b = bucketOf("2026-07-09T20:30:00Z");
    expect(b).toEqual({ weekday: 4, hour: 16, days: "weekdays", start: 16 });
    // 2026-01-11 is a Sunday; 02:10Z Monday UTC is 21:10 EST Sunday.
    const w = bucketOf(new Date("2026-01-12T02:10:00Z"));
    expect(w).toEqual({ weekday: 0, hour: 21, days: "weekends", start: 20 });
    expect(bucketOf("2026-07-09T06:00:00Z").start).toBe(-1); // 2am local
  });
});

// Knocks in one block group: Thursday 4–6pm EDT answered often, Thursday 12–2pm rarely, and two
// unanswered knocks in the prior's 6–8pm bucket (which pull that bucket's posterior down).
function knock(iso: string, outcome: Knock["outcome"]): Pick<Knock, "knocked_at" | "outcome"> {
  return { knocked_at: iso, outcome };
}
const LOG = [
  knock("2026-07-09T20:10:00Z", "quote_given"),
  knock("2026-07-09T20:20:00Z", "not_interested"),
  knock("2026-07-09T20:40:00Z", "booked"),
  knock("2026-07-09T21:00:00Z", "no_answer"),
  knock("2026-07-09T21:30:00Z", "call_back"),
  knock("2026-07-10T20:15:00Z", "not_interested"),
  knock("2026-07-10T20:45:00Z", "has_service"),
  knock("2026-07-09T16:10:00Z", "no_answer"),
  knock("2026-07-09T16:30:00Z", "no_answer"),
  knock("2026-07-09T17:10:00Z", "no_answer"),
  knock("2026-07-09T17:40:00Z", "not_interested"),
  knock("2026-07-09T22:10:00Z", "no_answer"),
  knock("2026-07-09T22:40:00Z", "no_answer"),
];

describe("learnedWindow", () => {
  const prior = range("weekdays", 18, 20);
  it("is null until the group has minKnocks knocks", () => {
    expect(learnedWindow(LOG.slice(0, 7), prior, 8)).toBeNull();
    expect(learnedWindow([], prior, 1)).toBeNull();
    expect(learnedWindow(LOG, prior, 8)).not.toBeNull();
  });
  it("shrinks toward the prior bucket and picks the best posterior mean", () => {
    const l = learnedWindow(LOG, prior, 8);
    expect(l?.knocks).toBe(13);
    const best = l?.best;
    expect(best?.days).toBe("weekdays");
    expect(best?.start).toBe(16);
    expect(best?.knocks).toBe(7);
    expect(best?.answers).toBe(6);
    // Non-prior bucket: alpha0 = 1, beta0 = 3 -> (1 + 6) / (1 + 3 + 7).
    expect(best?.mean).toBeCloseTo(7 / 11, 10);
    expect(l?.window).toEqual(range("weekdays", 16, 18));
    expect(l?.reason).toBe("Learned from 13 knocks: weekday 4–6pm answered 6 of 7 (~64% expected).");
    // Prior bucket: alpha0 = 4, beta0 = 2, two unanswered knocks -> (4 + 0) / (4 + 2 + 2).
    const priorBucket = l?.buckets["weekdays:18"];
    expect(priorBucket?.isPrior).toBe(true);
    expect(priorBucket?.alpha0).toBe(4);
    expect(priorBucket?.knocks).toBe(2);
    expect(priorBucket?.mean).toBeCloseTo(4 / 8, 10);
    // An untouched prior bucket (4/6 = 0.667) would still beat 6 of 7 (0.636): the shrinkage is deliberate.
    const untouched = learnedWindow(LOG.slice(0, 11), prior, 8);
    expect(untouched?.best.isPrior).toBe(true);
    expect(untouched?.window).toEqual(range("weekdays", 18, 20));
    const noon = l?.buckets["weekdays:12"];
    expect(noon?.knocks).toBe(4);
    expect(noon?.answers).toBe(1);
  });
  it("gives ties to the prior bucket and accepts a PriorWindow", () => {
    const pw: PriorWindow = { ...emptyPrior(), window: range("weekdays", 16, 18), pctNotInLf: 0.2 };
    // Two knocks, both answered, in a non-prior bucket: (1+2)/(4+2) = 0.5 < prior 0.667, prior keeps the window.
    const l = learnedWindow([knock("2026-07-09T22:10:00Z", "booked"), knock("2026-07-09T22:20:00Z", "booked")], pw, 2);
    expect(l?.window).toEqual(range("weekdays", 16, 18));
    expect(l?.best.isPrior).toBe(true);
    expect(l?.reason).toContain("nothing beat the area prior yet");
  });
  it("exposes the bucket for a slot", () => {
    const l = learnedWindow(LOG, prior, 8);
    expect(learnedBucketAt(l!, { weekday: 4, hour: 17 })?.start).toBe(16);
    expect(learnedBucketAt(l!, { weekday: 6, hour: 17 })?.days).toBe("weekends");
    expect(learnedBucketAt(l!, { weekday: 4, hour: 3 })).toBeNull();
  });
});

describe("answerProbability", () => {
  it("is the posterior mean with the right prior weights", () => {
    expect(answerProbability({ knocks: 0, answers: 0, isPrior: true })).toBeCloseTo(4 / 6, 10);
    expect(answerProbability({ knocks: 0, answers: 0 })).toBeCloseTo(1 / 4, 10);
    expect(answerProbability({ knocks: 10, answers: 5, alpha0: 1, beta0: 1 })).toBeCloseTo(6 / 12, 10);
  });
});

describe("resolveWindow", () => {
  const acs = { prior_window: acsPrior({ pct_not_in_lf: 0.25, pct_hh_nonworking_parent: 0.1, typicalDepart: 7.5, typicalCommute: 25 }, SETTINGS) };
  const learned = learnedWindow(LOG, acs.prior_window.window, 8);
  const base = { callback_window: null, home_pattern: null, do_not_knock: false };

  it("lets the homeowner override everything", () => {
    const r = resolveWindow({ parcel: { ...base, callback_window: "weekdays after 5", home_pattern: "weekends_only" }, blockGroup: acs, learned, settings: SETTINGS });
    expect(r.source).toBe("homeowner");
    expect(r.window).toEqual(range("weekdays", 17, 21));
    expect(r.label).toBe("Weekdays 5–9pm (homeowner)");
    expect(r.reason).toBe('Homeowner said: "weekdays after 5"');
    const vague = resolveWindow({ parcel: { ...base, callback_window: "ask for Dave" }, blockGroup: acs, learned, settings: SETTINGS });
    expect(vague.source).toBe("homeowner");
    expect(vague.label).toBe("Homeowner: ask for Dave");
  });
  it("lets the crew tag beat the learned layer", () => {
    const r = resolveWindow({ parcel: { ...base, home_pattern: "evenings_only" }, blockGroup: acs, learned, settings: SETTINGS });
    expect(r.source).toBe("crew");
    expect(r.window).toEqual(range("weekdays", 17, 20));
    expect(r.label).toBe("Weekday evenings (crew)");
    expect(resolveWindow({ parcel: { ...base, home_pattern: "home_weekdays" }, settings: SETTINGS }).label).toBe("Home weekdays (crew)");
    expect(resolveWindow({ parcel: { ...base, home_pattern: "weekends_only" }, settings: SETTINGS }).window).toEqual(range("weekends", 10, 16));
  });
  it("falls through 'unknown' to the learned layer, which needs minKnocks", () => {
    const r = resolveWindow({ parcel: { ...base, home_pattern: "unknown" }, blockGroup: acs, learned, settings: SETTINGS });
    expect(r.source).toBe("learned");
    expect(r.window).toEqual(range("weekdays", 16, 18));
    expect(r.label).toBe("Weekdays 4–6pm likely");
    const tooFew = resolveWindow({ parcel: base, blockGroup: acs, learned, settings: { learned_min_knocks: 20 } });
    expect(tooFew.source).toBe("acs");
    expect(resolveWindow({ parcel: base, blockGroup: acs, learned: null, settings: SETTINGS }).source).toBe("acs");
  });
  it("uses the ACS prior with its reason, and the daytime label", () => {
    const r = resolveWindow({ parcel: base, blockGroup: acs, settings: SETTINGS });
    expect(r.source).toBe("acs");
    expect(r.label).toBe("Weekdays 4–6pm likely");
    expect(r.reason).toContain("typical departure ~7:30am");
    const daytime = { prior_window: acsPrior({ pct_not_in_lf: 0.5, pct_hh_nonworking_parent: 0, typicalDepart: 8, typicalCommute: 20 }, SETTINGS) };
    const d = resolveWindow({ parcel: base, blockGroup: daytime, settings: SETTINGS });
    expect(d.label).toBe("Anytime weekdays (daytime OK)");
    expect(d.reason).toBe("Area: ~50% of households have a non-working adult → daytime OK.");
  });
  it("gives the default when nothing is known", () => {
    const r = resolveWindow({ parcel: base, blockGroup: null, settings: SETTINGS });
    expect(r).toEqual({ window: range("weekdays", 17, 19), label: "Weekdays 5–7pm (default)", source: "none", reason: "No area data yet" });
    expect(resolveWindow({ parcel: base, blockGroup: { prior_window: emptyPrior() }, settings: SETTINGS }).source).toBe("none");
  });
  it("marks do-not-knock houses", () => {
    const r = resolveWindow({ parcel: { ...base, callback_window: "evenings", do_not_knock: true }, blockGroup: acs, settings: SETTINGS });
    expect(r.source).toBe("none");
    expect(r.label).toBe("Do not knock");
  });
});
