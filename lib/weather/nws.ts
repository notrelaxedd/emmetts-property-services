/**
 * National Weather Service client (free, no key). NWS requires an identifying User-Agent.
 * Plain Node: global fetch, no next/* imports.
 */
import type { NwsPeriod } from "./parse";

export const NWS_USER_AGENT_DEFAULT = "(emmetts-property-services, ops@example.invalid)";

export async function getForecast(
  point: { lat: number; lng: number },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<NwsPeriod[]> {
  const f = opts.fetchImpl ?? fetch;
  const headers = {
    "User-Agent": process.env.NWS_USER_AGENT ?? NWS_USER_AGENT_DEFAULT,
    Accept: "application/geo+json",
  };
  // NWS wants at most 4 decimal places in /points.
  const url = `https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;

  const pointRes = await f(url, { headers });
  if (!pointRes.ok) throw new Error(`NWS points ${pointRes.status}`);
  const pointJson = (await pointRes.json()) as { properties?: { forecast?: string } };
  const forecastUrl = pointJson.properties?.forecast;
  if (!forecastUrl) throw new Error("NWS points response had no properties.forecast");

  const fcRes = await f(forecastUrl, { headers });
  if (!fcRes.ok) throw new Error(`NWS forecast ${fcRes.status}`);
  const fc = (await fcRes.json()) as { properties?: { periods?: NwsPeriod[] } };
  return fc.properties?.periods ?? [];
}
