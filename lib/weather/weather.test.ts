import { describe, expect, it, vi } from "vitest";
import { getForecast } from "./nws";
import { nwsForecastFixture, nwsPeriodsFixture, nwsPointsFixture } from "./nws.fixture";
import { parseSnowInches, summarizeForecast, weatherHoldCandidates } from "./parse";

describe("summarizeForecast", () => {
  const s = summarizeForecast(nwsPeriodsFixture, { days: 3 });

  it("has 14 fixture periods and windows to 3 days", () => {
    expect(nwsPeriodsFixture).toHaveLength(14);
    expect(s.periods.map((p) => p.name)).toEqual([
      "This Afternoon",
      "Tonight",
      "Tuesday",
      "Tuesday Night",
      "Wednesday",
      "Wednesday Night",
      "Thursday",
    ]);
    expect(s.periods[1]).toMatchObject({ short: "Rain Likely", precipChance: 70 });
    expect(s.periods[6].precipChance).toBeNull();
  });

  it("detects snow, first period, and total inches", () => {
    expect(s.snow.expected).toBe(true);
    expect(s.snow.firstPeriod).toBe("Tuesday Night");
    expect(s.snow.inches).toBe(5); // 3 + 2 (upper bounds)
    expect(s.snow.detail).toContain("Wednesday: Snow Likely");
  });

  it("detects rain only at >= 50% chance", () => {
    expect(s.rain.expected).toBe(true);
    expect(s.rain.periods).toEqual(["Tonight", "Tuesday", "Tuesday Night"]);
    expect(s.rain.periods).not.toContain("Thursday Night"); // 30%
  });

  it("respects the days window", () => {
    const one = summarizeForecast(nwsPeriodsFixture, { days: 1 });
    expect(one.snow.expected).toBe(false);
    expect(one.rain.periods).toEqual(["Tonight", "Tuesday"]); // Tuesday starts 06:00, inside 24h of 14:00
    const week = summarizeForecast(nwsPeriodsFixture, { days: 7 });
    expect(week.rain.periods).toContain("Friday");
  });

  it("handles no precipitation and empty input", () => {
    const dry = summarizeForecast(nwsPeriodsFixture.filter((p) => p.name === "Thursday"));
    expect(dry.snow.expected).toBe(false);
    expect(dry.rain).toMatchObject({ expected: false, periods: [] });
    expect(summarizeForecast([]).periods).toEqual([]);
  });

  it("parses snow inch phrases", () => {
    expect(parseSnowInches("New snow accumulation of 1 to 3 inches possible.")).toBe(3);
    expect(parseSnowInches("New snow accumulation of around an inch possible.")).toBe(1);
    expect(parseSnowInches("New snow accumulation of less than half an inch possible.")).toBe(0.5);
    expect(parseSnowInches("Cloudy.")).toBeNull();
  });
});

describe("weatherHoldCandidates", () => {
  const s = summarizeForecast(nwsPeriodsFixture, { days: 3 });
  it("returns jobs starting in a rainy period", () => {
    const ids = weatherHoldCandidates(
      [
        { id: "mon-afternoon-dry", start_at: "2026-12-07T15:00:00-05:00" },
        { id: "mon-night-rain", start_at: "2026-12-07T20:00:00-05:00" },
        { id: "tue-morning-rain", start_at: "2026-12-08T09:00:00-05:00" },
        { id: "thu-dry", start_at: "2026-12-10T09:00:00-05:00" },
        { id: "unscheduled", start_at: null },
      ],
      s,
    );
    expect(ids).toEqual(["mon-night-rain", "tue-morning-rain"]);
  });
  it("returns [] when no rain is expected", () => {
    const dry = summarizeForecast(nwsPeriodsFixture, { days: 1 }).rain.expected;
    expect(dry).toBe(true);
    expect(weatherHoldCandidates([{ id: "a", start_at: "2026-12-10T09:00:00-05:00" }], summarizeForecast([]))).toEqual([]);
  });
});

describe("getForecast", () => {
  it("follows properties.forecast with a User-Agent", async () => {
    const f = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("/points/") ? nwsPointsFixture : nwsForecastFixture), { status: 200 }),
    );
    const periods = await getForecast({ lat: 41.4756, lng: -81.8396 }, { fetchImpl: f as unknown as typeof fetch });
    expect(periods).toHaveLength(14);
    const calls = f.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe("https://api.weather.gov/points/41.4756,-81.8396");
    expect(calls[1][0]).toBe(nwsPointsFixture.properties.forecast);
    expect((calls[0][1].headers as Record<string, string>)["User-Agent"]).toMatch(/emmetts-property-services/);
  });
  it("throws on a non-OK response", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(getForecast({ lat: 1, lng: 2 }, { fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(/500/);
  });
  it("names the point and the NWS detail when /points fails", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: "Data Unavailable For Requested Point", detail: "Unable to provide data for requested point 41.4756,81.8396" }), {
          status: 404,
        }),
    );
    await expect(getForecast({ lat: 41.4756, lng: 81.8396 }, { fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(
      "NWS points 404 for 41.4756,81.8396: Unable to provide data for requested point 41.4756,81.8396",
    );
  });
});
