/**
 * Address geocoding. Provider chosen by GEOCODER env: none (default) | nominatim | google | mapbox.
 * TODO [GEOCODER — ask owner]: which provider to use. "none" returns null (address stays free text).
 * Plain Node: global fetch, no next/* imports.
 */

export type GeocodeResult = { lat: number; lng: number; formatted: string; parcel_hint?: string };

type Opts = { fetchImpl?: typeof fetch };

export const NOMINATIM_USER_AGENT_DEFAULT = "emmetts-property-services/1.0 (ops@example.invalid)";

export function nominatimUrl(address: string): string {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("q", address);
  u.searchParams.set("limit", "1");
  u.searchParams.set("addressdetails", "1");
  return u.toString();
}

export function googleUrl(address: string, key: string): string {
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", address);
  u.searchParams.set("key", key);
  return u.toString();
}

export function mapboxUrl(address: string, key: string): string {
  const u = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  u.searchParams.set("q", address);
  u.searchParams.set("limit", "1");
  u.searchParams.set("access_token", key);
  return u.toString();
}

// Nominatim usage policy: max 1 request/second. Serialize through a promise chain.
let nominatimChain: Promise<void> = Promise.resolve();
let lastNominatimAt = 0;
const NOMINATIM_GAP_MS = 1000;

/** Test hook. */
export function _resetNominatimThrottle() {
  nominatimChain = Promise.resolve();
  lastNominatimAt = 0;
}

function throttleNominatim(): Promise<void> {
  const run = nominatimChain.then(async () => {
    const wait = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
  });
  nominatimChain = run.catch(() => undefined);
  return run;
}

async function getJson(f: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await f(url, { headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`geocoder ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function geocode(address: string, opts: Opts = {}): Promise<GeocodeResult | null> {
  const q = address.trim();
  const provider = process.env.GEOCODER ?? "none";
  if (provider === "none" || !q) return null;
  const f = opts.fetchImpl ?? fetch;

  switch (provider) {
    case "nominatim": {
      await throttleNominatim();
      const json = (await getJson(f, nominatimUrl(q), {
        "User-Agent": process.env.GEOCODER_USER_AGENT ?? NOMINATIM_USER_AGENT_DEFAULT,
      })) as Array<{ lat?: string; lon?: string; display_name?: string; osm_id?: number | string }>;
      const hit = Array.isArray(json) ? json[0] : undefined;
      const lat = num(hit?.lat);
      const lng = num(hit?.lon);
      if (!hit || lat === null || lng === null) return null;
      return { lat, lng, formatted: hit.display_name ?? q };
    }
    case "google": {
      const key = process.env.GEOCODER_API_KEY;
      if (!key) throw new Error("GEOCODER_API_KEY is required when GEOCODER=google");
      const json = (await getJson(f, googleUrl(q, key))) as {
        status?: string;
        error_message?: string;
        results?: Array<{ formatted_address?: string; place_id?: string; geometry?: { location?: { lat: number; lng: number } } }>;
      };
      if (json.status === "ZERO_RESULTS") return null;
      if (json.status !== "OK") throw new Error(`google geocoder ${json.status}: ${json.error_message ?? ""}`);
      const r = json.results?.[0];
      const loc = r?.geometry?.location;
      if (!r || !loc) return null;
      return { lat: loc.lat, lng: loc.lng, formatted: r.formatted_address ?? q, parcel_hint: r.place_id };
    }
    case "mapbox": {
      const key = process.env.GEOCODER_API_KEY;
      if (!key) throw new Error("GEOCODER_API_KEY is required when GEOCODER=mapbox");
      const json = (await getJson(f, mapboxUrl(q, key))) as {
        features?: Array<{
          id?: string;
          geometry?: { coordinates?: [number, number] };
          properties?: { full_address?: string; name?: string; mapbox_id?: string };
        }>;
      };
      const feat = json.features?.[0];
      const c = feat?.geometry?.coordinates;
      if (!feat || !c) return null;
      return {
        lat: c[1],
        lng: c[0],
        formatted: feat.properties?.full_address ?? feat.properties?.name ?? q,
        parcel_hint: feat.properties?.mapbox_id,
      };
    }
    default:
      throw new Error(`Unknown GEOCODER "${provider}" (expected none | nominatim | google | mapbox)`);
  }
}
