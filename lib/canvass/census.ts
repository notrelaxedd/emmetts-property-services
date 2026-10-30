/**
 * Census ACS 5-year block-group aggregates for Cuyahoga County (api.census.gov). Plain Node: global fetch,
 * no next/* or db imports; every network call takes `fetchImpl` so tests run on fixtures.
 *
 * Variable ids are never guessed: each table's group metadata (`/groups/<table>.json`) is fetched and the estimate
 * variables are picked by their LABEL ("Estimate!!Total:!!Not in labor force"), which is what the API documents.
 * Matching is tolerant to the trailing-colon variants that differ between vintages.
 *
 * Only aggregates ever leave this module: a block group is ~600-3,000 people. Nothing here is about a person.
 *
 * ---- Why B23007 (and not B11003) for "share of families with a non-working parent" ----
 * B11003 ("Family type by presence and age of own children under 18") only says what kind of family lives there,
 * not whether anyone works. B23007 ("Presence of own children under 18 by family type by employment status of
 * parents") counts families with own children under 18 and, for married couples, whether both / only the father /
 * only the mother / neither parent is in the labor force; for single-parent families, whether the householder is in
 * the labor force. So "at least one parent not in the labor force" is a direct sum of B23007 cells:
 *   married: father only + mother only + neither parent in labor force
 *   other:   male householder not in labor force + female householder not in labor force
 * divided by "With own children of the householder under 18 years" (the family-with-kids total). That is exactly the
 * "someone is likely home on a weekday" signal the window logic wants, hence B23007.
 */

export const ACS_STATE = "39"; // Ohio
export const ACS_COUNTY = "035"; // Cuyahoga
export const DEFAULT_ACS_VINTAGE = "2023";
export const CENSUS_TIMEOUT_MS = 15_000;

export const ACS_TABLES = ["B08302", "B08303", "B23025", "B01001", "B23007", "B19013"] as const;
export type AcsTable = (typeof ACS_TABLES)[number];

export function acsBase(vintage: string = DEFAULT_ACS_VINTAGE): string {
  return `https://api.census.gov/data/${encodeURIComponent(vintage)}/acs/acs5`;
}

export function acsGroupUrl(table: AcsTable, vintage: string = DEFAULT_ACS_VINTAGE): string {
  return `${acsBase(vintage)}/groups/${table}.json`;
}

/** Data URL for every block group in Cuyahoga County. `key` is optional (CENSUS_API_KEY); the API allows ~500 calls/day without. */
export function acsDataUrl(variables: string[], vintage: string = DEFAULT_ACS_VINTAGE, key?: string | null): string {
  const get = ["NAME", ...variables].join(",");
  let url = `${acsBase(vintage)}?get=${get}&for=block%20group:*&in=state:${ACS_STATE}&in=county:${ACS_COUNTY}&in=tract:*`;
  if (key) url += `&key=${encodeURIComponent(key)}`;
  return url;
}

// ---------- Group metadata → variable ids ----------

export type AcsGroupJson = { variables: Record<string, { label?: string; concept?: string; predicateType?: string }> };

export type AcsRole =
  | "bucket" // B08302 (hours) / B08303 (minutes)
  | "not_in_lf" // B23025
  | "age_65_plus" // B01001
  | "families_with_children" // B23007 denominator
  | "nonworking_parent" // B23007 numerator cells
  | "median_income"; // B19013

export type AcsPart = {
  id: string;
  /** The last label segment, e.g. "7:00 a.m. to 7:29 a.m." or "Not in labor force". */
  label: string;
  role: AcsRole;
  /** Buckets only: start/end in decimal hours (B08302) or minutes (B08303). */
  start?: number;
  end?: number;
};

export type ResolvedTable = {
  table: AcsTable;
  /** "Estimate!!Total:" (null when the group has none, e.g. B19013 whose single variable is the median). */
  total: string | null;
  parts: AcsPart[];
  /** Every variable id to request, in order (total first). */
  ids: string[];
};

/** "Estimate!!Total:!!Male:!!65 and 66 years" → ["total", "male", "65 and 66 years"] (lower-cased, colons dropped). */
export function labelPath(label: string): string[] {
  const segs = label
    .split("!!")
    .map((s) => s.trim().replace(/:+$/, "").trim().toLowerCase())
    .filter((s) => s.length > 0);
  return segs[0] === "estimate" ? segs.slice(1) : segs;
}

const isEstimate = (id: string, label: string) => /E$/.test(id) && /^estimate/i.test(label.trim());

/** "7:00 a.m. to 7:29 a.m." / "12:00 p.m. to 3:59 p.m." → [7, 7.5] / [12, 16] decimal hours (end is exclusive, rounded up). */
export function parseDepartLabel(label: string): [number, number] | null {
  const m = /(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\s*to\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i.exec(label);
  if (!m) return null;
  const hour = (h: string, min: string, ap: string) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === "p") hh += 12;
    return hh + Number(min) / 60;
  };
  const start = hour(m[1], m[2], m[3]);
  // "7:29" means up to the end of that minute: 7:30 exclusive.
  const end = hour(m[4], m[5], m[6]) + 1 / 60;
  return [start, Math.round(end * 1000) / 1000];
}

/** "Less than 5 minutes" → [0, 5]; "5 to 9 minutes" → [5, 10]; "90 or more minutes" → [90, 120]. */
export function parseCommuteLabel(label: string): [number, number] | null {
  const s = label.toLowerCase();
  let m = /less than (\d+) minutes?/.exec(s);
  if (m) return [0, Number(m[1])];
  m = /(\d+) to (\d+) minutes?/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]) + 1];
  m = /(\d+) or more minutes?/.exec(s);
  if (m) return [Number(m[1]), Number(m[1]) + 30];
  return null;
}

/** The first number in an age label ("65 and 66 years", "85 years and over", "Under 5 years"), or null. */
function ageStart(seg: string): number | null {
  if (/^under\s+\d+/.test(seg)) return 0;
  const m = /^(\d+)/.exec(seg);
  return m ? Number(m[1]) : null;
}

/**
 * Pick the estimate variables a table needs by label. Throws when the labels the table is known for are not there
 * (a vintage with a changed layout), so the pull fails loudly instead of storing zeros.
 */
export function resolveVariables(table: AcsTable, group: AcsGroupJson): ResolvedTable {
  const vars = Object.entries(group.variables ?? {})
    .filter(([id, v]) => isEstimate(id, v.label ?? ""))
    .map(([id, v]) => ({ id, label: v.label ?? "", path: labelPath(v.label ?? "") }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const total = vars.find((v) => v.path.length === 1 && v.path[0] === "total")?.id ?? null;
  const parts: AcsPart[] = [];
  const last = (p: string[]) => p[p.length - 1];

  switch (table) {
    case "B08302":
      for (const v of vars) {
        if (v.path.length !== 2) continue;
        const range = parseDepartLabel(last(v.path));
        if (range) parts.push({ id: v.id, label: lastRaw(v.label), role: "bucket", start: range[0], end: range[1] });
      }
      break;
    case "B08303":
      for (const v of vars) {
        if (v.path.length !== 2) continue;
        const range = parseCommuteLabel(last(v.path));
        if (range) parts.push({ id: v.id, label: lastRaw(v.label), role: "bucket", start: range[0], end: range[1] });
      }
      break;
    case "B23025":
      for (const v of vars) {
        if (v.path.length === 2 && last(v.path) === "not in labor force") parts.push({ id: v.id, label: lastRaw(v.label), role: "not_in_lf" });
      }
      break;
    case "B01001":
      for (const v of vars) {
        if (v.path.length !== 3 || (v.path[1] !== "male" && v.path[1] !== "female")) continue;
        const start = ageStart(last(v.path));
        if (start !== null && start >= 65) parts.push({ id: v.id, label: `${v.path[1]}: ${lastRaw(v.label)}`, role: "age_65_plus" });
      }
      break;
    case "B23007":
      for (const v of vars) {
        if (v.path.length < 2 || !v.path[1].startsWith("with own children")) continue;
        if (v.path.length === 2) {
          parts.push({ id: v.id, label: lastRaw(v.label), role: "families_with_children" });
          continue;
        }
        const leaf = last(v.path);
        const marriedNonworking =
          leaf === "father only in labor force" || leaf === "mother only in labor force" || leaf === "neither parent in labor force";
        const singleNonworking = leaf === "not in labor force" && v.path.some((seg) => seg.includes("householder"));
        if (marriedNonworking || singleNonworking) parts.push({ id: v.id, label: v.path.slice(2).join(" / "), role: "nonworking_parent" });
      }
      break;
    case "B19013": {
      const v = vars.find((x) => x.label.toLowerCase().includes("median household income")) ?? vars[0];
      if (v) parts.push({ id: v.id, label: lastRaw(v.label), role: "median_income" });
      break;
    }
  }

  const needsTotal = table !== "B19013";
  if (needsTotal && !total) throw new Error(`ACS ${table}: no "Estimate!!Total:" variable in group metadata`);
  if (parts.length === 0) throw new Error(`ACS ${table}: none of the expected labels found in group metadata`);
  if (table === "B23007" && !parts.some((p) => p.role === "families_with_children")) {
    throw new Error('ACS B23007: "With own children of the householder under 18 years" not found');
  }
  const ids = [...(total ? [total] : []), ...parts.map((p) => p.id)];
  return { table, total, parts, ids };
}

function lastRaw(label: string): string {
  const segs = label.split("!!").map((s) => s.trim().replace(/:+$/, "").trim());
  return segs[segs.length - 1] ?? label;
}

// ---------- Fetching ----------

export type CensusOpts = { fetchImpl?: typeof fetch; vintage?: string; key?: string | null };

async function censusJson<T>(f: typeof fetch, url: string, what: string): Promise<T> {
  const res = await f(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`census ${what} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export async function fetchGroup(table: AcsTable, opts: CensusOpts = {}): Promise<AcsGroupJson> {
  const f = opts.fetchImpl ?? fetch;
  return censusJson<AcsGroupJson>(f, acsGroupUrl(table, opts.vintage ?? DEFAULT_ACS_VINTAGE), `group ${table}`);
}

export type AcsRow = { geoid: string; values: Record<string, number | null> };
export type AcsTableData = { resolved: ResolvedTable; rows: AcsRow[] };

/** Census null sentinels (-666666666, -999999999, …) and anything non-numeric → null. */
export function acsValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** The API's array-of-arrays (header row first) → rows keyed by 12-digit GEOID. */
export function parseAcsRows(data: unknown, ids: string[]): AcsRow[] {
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[0])) return [];
  const header = (data[0] as unknown[]).map((h) => String(h));
  const col = (name: string) => header.indexOf(name);
  const iState = col("state");
  const iCounty = col("county");
  const iTract = col("tract");
  const iBg = col("block group");
  if ([iState, iCounty, iTract, iBg].some((i) => i < 0)) throw new Error("census data: geography columns missing");
  const idCols = ids.map((id) => [id, col(id)] as const);
  const rows: AcsRow[] = [];
  for (const raw of data.slice(1) as unknown[][]) {
    const geoid = `${raw[iState]}${raw[iCounty]}${raw[iTract]}${raw[iBg]}`;
    if (!/^\d{12}$/.test(geoid)) continue;
    const values: Record<string, number | null> = {};
    for (const [id, i] of idCols) values[id] = i < 0 ? null : acsValue(raw[i]);
    rows.push({ geoid, values });
  }
  return rows;
}

/**
 * One table for every block group in the county (~1,000 rows, one request): resolves the variables from the group
 * metadata (unless `resolved` is passed), then fetches the data.
 */
export async function fetchBlockGroupTable(
  table: AcsTable,
  opts: CensusOpts & { resolved?: ResolvedTable } = {},
): Promise<AcsTableData> {
  const f = opts.fetchImpl ?? fetch;
  const vintage = opts.vintage ?? DEFAULT_ACS_VINTAGE;
  const key = opts.key === undefined ? process.env.CENSUS_API_KEY ?? null : opts.key;
  const resolved = opts.resolved ?? resolveVariables(table, await fetchGroup(table, { fetchImpl: f, vintage }));
  const data = await censusJson<unknown>(f, acsDataUrl(resolved.ids, vintage, key), `data ${table}`);
  return { resolved, rows: parseAcsRows(data, resolved.ids) };
}

/** All six tables, one after another (the Census API is rate limited; sequential is kind). */
export async function fetchAllBlockGroupTables(opts: CensusOpts = {}): Promise<Partial<Record<AcsTable, AcsTableData>>> {
  const out: Partial<Record<AcsTable, AcsTableData>> = {};
  for (const table of ACS_TABLES) out[table] = await fetchBlockGroupTable(table, opts);
  return out;
}

// ---------- Rows → block-group stats ----------

/** The ACS columns of a `block_groups` row (plus the two distributions stored as jsonb). */
export type BlockGroupStats = {
  pct_not_in_lf: number | null;
  pct_hh_nonworking_parent: number | null;
  pct_65_plus: number | null;
  median_hh_income: number | null;
  /** { "<B08302 bucket label>": count } */
  depart_dist: Record<string, number>;
  /** { "<B08303 bucket label>": count } */
  commute_dist: Record<string, number>;
};

const ratio = (num: number | null, den: number | null): number | null =>
  num === null || den === null || den <= 0 ? null : Math.round((num / den) * 10_000) / 10_000;

const sumRoles = (row: AcsRow | undefined, resolved: ResolvedTable, role: AcsRole): number | null => {
  if (!row) return null;
  let sum = 0;
  let any = false;
  for (const p of resolved.parts) {
    if (p.role !== role) continue;
    const v = row.values[p.id];
    if (v === null || v === undefined) continue;
    sum += v;
    any = true;
  }
  return any ? sum : null;
};

const dist = (row: AcsRow | undefined, resolved: ResolvedTable): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!row) return out;
  for (const p of resolved.parts) {
    if (p.role !== "bucket") continue;
    const v = row.values[p.id];
    if (v !== null && v !== undefined) out[p.label] = v;
  }
  return out;
};

/** Combine the per-table rows into one stats record per GEOID (a block group missing from a table gets nulls there). */
export function parseAcs(tables: Partial<Record<AcsTable, AcsTableData>>): Map<string, BlockGroupStats> {
  const byGeoid = new Map<string, Partial<Record<AcsTable, AcsRow>>>();
  for (const table of ACS_TABLES) {
    for (const row of tables[table]?.rows ?? []) {
      const slot = byGeoid.get(row.geoid) ?? {};
      slot[table] = row;
      byGeoid.set(row.geoid, slot);
    }
  }
  const out = new Map<string, BlockGroupStats>();
  for (const [geoid, rows] of Array.from(byGeoid.entries())) {
    const t = (table: AcsTable) => tables[table]?.resolved;
    const totalOf = (table: AcsTable) => {
      const r = t(table);
      return r?.total ? (rows[table]?.values[r.total] ?? null) : null;
    };
    const b23025 = t("B23025");
    const b01001 = t("B01001");
    const b23007 = t("B23007");
    const b19013 = t("B19013");
    const b08302 = t("B08302");
    const b08303 = t("B08303");
    const medianId = b19013?.parts.find((p) => p.role === "median_income")?.id;
    out.set(geoid, {
      pct_not_in_lf: b23025 ? ratio(sumRoles(rows.B23025, b23025, "not_in_lf"), totalOf("B23025")) : null,
      pct_hh_nonworking_parent: b23007
        ? ratio(sumRoles(rows.B23007, b23007, "nonworking_parent"), sumRoles(rows.B23007, b23007, "families_with_children"))
        : null,
      pct_65_plus: b01001 ? ratio(sumRoles(rows.B01001, b01001, "age_65_plus"), totalOf("B01001")) : null,
      median_hh_income: medianId ? (rows.B19013?.values[medianId] ?? null) : null,
      depart_dist: b08302 ? dist(rows.B08302, b08302) : {},
      commute_dist: b08303 ? dist(rows.B08303, b08303) : {},
    });
  }
  return out;
}

// ---------- Typical departure / commute ----------

/** The ACS inputs `acsPrior` (windows.ts) needs, straight from a `block_groups` row or `parseAcs` stats. */
export type AcsPriorInput = {
  pct_not_in_lf: number | null;
  pct_hh_nonworking_parent: number | null;
  /** Weighted-median departure, decimal hours. */
  typicalDepart: number | null;
  /** Weighted-median one-way commute, minutes. */
  typicalCommute: number | null;
};

/** `block_groups` row (or `BlockGroupStats`) → the stats `acsPrior` takes, with the two typicals computed. */
export function acsStatsOf(
  row: Pick<BlockGroupStats, "pct_not_in_lf" | "pct_hh_nonworking_parent" | "depart_dist" | "commute_dist"> | null | undefined,
): AcsPriorInput | null {
  if (!row) return null;
  return {
    pct_not_in_lf: row.pct_not_in_lf,
    pct_hh_nonworking_parent: row.pct_hh_nonworking_parent,
    typicalDepart: typicalDepart(row.depart_dist),
    typicalCommute: typicalCommute(row.commute_dist),
  };
}

function weightedMedianBucket(
  buckets: { start: number; end: number; count: number }[],
): { start: number; end: number } | null {
  const sorted = buckets.filter((b) => b.count > 0).sort((a, b) => a.start - b.start);
  const total = sorted.reduce((s, b) => s + b.count, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const b of sorted) {
    acc += b.count;
    if (acc >= total / 2) return b;
  }
  return sorted[sorted.length - 1];
}

/**
 * Typical time workers leave home: the midpoint of the weighted-median B08302 bucket, in decimal hours
 * (7.25 = 7:15am). Null when the distribution is empty. Bucket labels that do not parse are ignored.
 */
export function typicalDepart(departDist: Record<string, number> | null | undefined): number | null {
  const buckets: { start: number; end: number; count: number }[] = [];
  for (const [label, count] of Object.entries(departDist ?? {})) {
    const r = parseDepartLabel(label);
    if (r && Number.isFinite(count)) buckets.push({ start: r[0], end: r[1], count });
  }
  const b = weightedMedianBucket(buckets);
  return b ? Math.round(((b.start + b.end) / 2) * 100) / 100 : null;
}

/** Typical one-way commute in minutes: the midpoint of the weighted-median B08303 bucket. Null when empty. */
export function typicalCommute(commuteDist: Record<string, number> | null | undefined): number | null {
  const buckets: { start: number; end: number; count: number }[] = [];
  for (const [label, count] of Object.entries(commuteDist ?? {})) {
    const r = parseCommuteLabel(label);
    if (r && Number.isFinite(count)) buckets.push({ start: r[0], end: r[1], count });
  }
  const b = weightedMedianBucket(buckets);
  return b ? Math.round(((b.start + b.end) / 2) * 10) / 10 : null;
}
