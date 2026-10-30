import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetWeatherCache, fetchKnockWeather, openMeteoUrl, weatherCacheKey, wmoLabel } from "./weather";

const ROCKY_RIVER = { lat: 41.4756, lng: -81.8396 };

const okResponse = (current: Record<string, unknown>) =>
  new Response(
    JSON.stringify({
      latitude: 41.5,
      longitude: -81.875,
      current_units: { temperature_2m: "°F", precipitation: "inch", weather_code: "wmo code" },
      current: { time: "2026-10-30T15:00", interval: 900, ...current },
    }),
    { status: 200 },
  );

describe("weather", () => {
  beforeEach(() => _resetWeatherCache());

  it("builds the Open-Meteo URL with fahrenheit / inch / New York time", () => {
    const u = new URL(openMeteoUrl(ROCKY_RIVER.lat, ROCKY_RIVER.lng));
    expect(u.host).toBe("api.open-meteo.com");
    expect(u.pathname).toBe("/v1/forecast");
    expect(u.searchParams.get("latitude")).toBe("41.4756");
    expect(u.searchParams.get("longitude")).toBe("-81.8396");
    expect(u.searchParams.get("current")).toBe("temperature_2m,precipitation,weather_code");
    expect(u.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(u.searchParams.get("precipitation_unit")).toBe("inch");
    expect(u.searchParams.get("timezone")).toBe("America/New_York");
  });

  it("maps the response to KnockWeather with a WMO label", async () => {
    const f = vi.fn(async () => okResponse({ temperature_2m: 54.3, precipitation: 0.02, weather_code: 61 }));
    const w = await fetchKnockWeather(ROCKY_RIVER.lat, ROCKY_RIVER.lng, { fetchImpl: f as unknown as typeof fetch });
    expect(w).toEqual({ temp_f: 54.3, precip_in: 0.02, code: 61, label: "Slight rain" });
    expect(f).toHaveBeenCalledTimes(1);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("labels unknown and missing codes without throwing", async () => {
    expect(wmoLabel(null)).toBe("Unknown");
    expect(wmoLabel(123)).toBe("Code 123");
    expect(wmoLabel(0)).toBe("Clear sky");
    const f = vi.fn(async () => okResponse({ temperature_2m: "41", precipitation: null }));
    expect(await fetchKnockWeather(ROCKY_RIVER.lat, ROCKY_RIVER.lng, { fetchImpl: f as unknown as typeof fetch })).toEqual({
      temp_f: 41,
      precip_in: null,
      code: null,
      label: "Unknown",
    });
  });

  it("caches for 10 minutes keyed by coords rounded to 2 decimals", async () => {
    let t = 1_000_000;
    const now = () => t;
    const f = vi.fn(async () => okResponse({ temperature_2m: 60, precipitation: 0, weather_code: 1 }));
    const opts = { fetchImpl: f as unknown as typeof fetch, now };
    expect(weatherCacheKey(41.4756, -81.8396)).toBe("41.48,-81.84");
    await fetchKnockWeather(41.4756, -81.8396, opts);
    await fetchKnockWeather(41.4791, -81.8362, opts); // same 2-decimal cell
    expect(f).toHaveBeenCalledTimes(1);
    await fetchKnockWeather(41.49, -81.84, opts); // a different cell
    expect(f).toHaveBeenCalledTimes(2);
    t += 10 * 60 * 1000 + 1;
    await fetchKnockWeather(41.4756, -81.8396, opts);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("returns null (never throws) on HTTP errors, bad JSON, network failures and timeouts", async () => {
    const bad = vi.fn(async () => new Response("nope", { status: 503 }));
    expect(await fetchKnockWeather(41.4756, -81.8396, { fetchImpl: bad as unknown as typeof fetch })).toBeNull();

    const garbage = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await fetchKnockWeather(41.4756, -81.8396, { fetchImpl: garbage as unknown as typeof fetch })).toBeNull();

    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchKnockWeather(41.4756, -81.8396, { fetchImpl: down as unknown as typeof fetch })).toBeNull();

    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const t0 = Date.now();
    expect(await fetchKnockWeather(41.4756, -81.8396, { fetchImpl: slow as unknown as typeof fetch, timeoutMs: 30 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2_000);

    expect(await fetchKnockWeather(Number.NaN, 1, { fetchImpl: bad as unknown as typeof fetch })).toBeNull();
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    let calls = 0;
    const f = vi.fn(async () => (++calls === 1 ? new Response("x", { status: 500 }) : okResponse({ temperature_2m: 50, weather_code: 3 })));
    const opts = { fetchImpl: f as unknown as typeof fetch };
    expect(await fetchKnockWeather(41.4756, -81.8396, opts)).toBeNull();
    expect(await fetchKnockWeather(41.4756, -81.8396, opts)).toMatchObject({ temp_f: 50, label: "Overcast" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
