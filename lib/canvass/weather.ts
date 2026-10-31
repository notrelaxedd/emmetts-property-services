/**
 * Open-Meteo current conditions for the knock log (free, no key). Plain Node: global fetch, no next/* imports.
 *
 * Never throws: the knock must be logged in under 3 seconds whether or not the weather call works, so any
 * failure (network, timeout, bad JSON) yields null and the knock stores `weather = null`.
 */
import type { KnockWeather } from "./types";

export const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_TIMEOUT_MS = 3_000;
export const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

/** WMO 4677-style weather interpretation codes as Open-Meteo documents them. */
export const WMO_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export function wmoLabel(code: number | null | undefined): string {
  if (code === null || code === undefined || !Number.isFinite(code)) return "Unknown";
  return WMO_LABELS[code] ?? `Code ${code}`;
}

export function openMeteoUrl(lat: number, lng: number): string {
  const u = new URL(OPEN_METEO_FORECAST);
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("current", "temperature_2m,precipitation,weather_code");
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("precipitation_unit", "inch");
  u.searchParams.set("timezone", "America/New_York");
  return u.toString();
}

/** Cache key: two decimals (~1 km), so a whole street shares one lookup. */
export function weatherCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

const cache = new Map<string, { at: number; value: KnockWeather }>();

/** Test hook. */
export function _resetWeatherCache() {
  cache.clear();
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export type WeatherOpts = {
  fetchImpl?: typeof fetch;
  /** Clock, for tests. */
  now?: () => number;
  timeoutMs?: number;
};

/** Current conditions at the knock, or null when anything goes wrong (never throws). */
export async function fetchKnockWeather(lat: number, lng: number, opts: WeatherOpts = {}): Promise<KnockWeather | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const now = opts.now ?? Date.now;
  const key = weatherCacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && now() - hit.at < WEATHER_CACHE_TTL_MS) return hit.value;

  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? WEATHER_TIMEOUT_MS;
  try {
    const res = await f(openMeteoUrl(lat, lng), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: { temperature_2m?: unknown; precipitation?: unknown; weather_code?: unknown };
    };
    const cur = json.current;
    if (!cur || typeof cur !== "object") return null;
    const code = num(cur.weather_code);
    const value: KnockWeather = {
      temp_f: num(cur.temperature_2m),
      precip_in: num(cur.precipitation),
      code: code === null ? null : Math.round(code),
      label: wmoLabel(code === null ? null : Math.round(code)),
    };
    cache.set(key, { at: now(), value });
    return value;
  } catch {
    return null;
  }
}
