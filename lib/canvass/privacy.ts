/**
 * The privacy guard for the Canvass tab. Pure: no next/* or db imports (privacy.test.ts does the file walking).
 *
 * The product rule: parcel data comes from the county, aggregates from the Census, timing from what the crew saw
 * and what the homeowner said, and nothing about any individual from anywhere else. Enforced two ways:
 *   1. every `https?://host` in canvass source must be in ALLOWED_HOSTS (data hosts) or ALLOWED_LINK_HOSTS
 *      (href / attribution / XML-namespace URLs that are never fetched for data);
 *   2. DENYLIST substrings (people-search, broker and social sites) must never appear at all.
 */

/** Hosts canvass code may call, exactly as the spec lists them, plus loopback / RFC 2606 names for tests. */
export const ALLOWED_HOSTS: readonly string[] = [
  "gis.cuyahogacounty.gov", // county parcel layer (+ aerial imagery)
  "api.census.gov", // ACS 5-year block-group aggregates
  "tigerweb.geo.census.gov", // block-group polygons
  "geocoding.geo.census.gov", // block-group fallback for a centroid
  "api.open-meteo.com", // weather at the knock
  "server.arcgisonline.com", // satellite tiles (browser only)
  "tile.openstreetmap.org", // street tiles (browser only)
  "api.anthropic.com", // nightly summary, via lib/ai only
  "localhost",
  "127.0.0.1",
  "example.com",
  "example.invalid",
];

/**
 * Hosts that may appear only as links or namespaces (map attribution, the MyPlace spot-check link, the Census key
 * sign-up, SVG/XHTML namespaces). Nothing is ever fetched from them by canvass code.
 */
export const ALLOWED_LINK_HOSTS: readonly string[] = [
  "www.openstreetmap.org", // tile attribution link
  "www.esri.com", // imagery attribution link
  "myplace.cuyahogacounty.gov", // the county's public property lookup, for spot checks
  "www.w3.org", // xmlns
];

/** Substrings that must never appear in canvass source (case-insensitive). */
export const DENYLIST: readonly string[] = [
  "linkedin",
  "spokeo",
  "whitepages",
  "beenverified",
  "truepeoplesearch",
  "facebook.com",
  "zillow",
  "peoplefinder",
  "intelius",
];

/** Directories whose .ts/.tsx files the guard walks (relative to the repo root). */
export const GUARDED_DIRS: readonly string[] = [
  "lib/canvass",
  "app/admin/canvass",
  "app/crew/knock",
  "app/h",
  "app/api/cron",
  "components/admin/canvass",
  "components/crew/knock",
];

const HOST_RE = /https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?/g;

/** "HTTPS://Api.Census.gov:443/x" → "api.census.gov". */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, "");
}

/** Every distinct host in `https?://host[:port]` occurrences, in order of first appearance. */
export function extractHosts(source: string): string[] {
  const seen = new Set<string>();
  const re = new RegExp(HOST_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const host = normalizeHost(m[1]);
    if (host) seen.add(host);
  }
  return Array.from(seen);
}

/** True for a data host canvass code may call. */
export function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.includes(normalizeHost(host));
}

/** True for a data host or a link-only host. */
export function isAllowedHostOrLink(host: string): boolean {
  const h = normalizeHost(host);
  return ALLOWED_HOSTS.includes(h) || ALLOWED_LINK_HOSTS.includes(h);
}

/** The denylist entries found in the text (case-insensitive). */
export function deniedTerms(source: string): string[] {
  const lower = source.toLowerCase();
  return DENYLIST.filter((term) => lower.includes(term));
}

export type PrivacyViolation = { file: string; kind: "host" | "denylist"; detail: string };

/** Every violation in one file's source: hosts outside both allowlists and denylisted terms. */
export function auditSource(file: string, source: string): PrivacyViolation[] {
  const out: PrivacyViolation[] = [];
  for (const host of extractHosts(source)) {
    if (!isAllowedHostOrLink(host)) out.push({ file, kind: "host", detail: host });
  }
  for (const term of deniedTerms(source)) out.push({ file, kind: "denylist", detail: term });
  return out;
}
