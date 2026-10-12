/** Pure forecast parsing: no I/O. Input is the `properties.periods` array from api.weather.gov. */

export type NwsPeriod = {
  number?: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  temperatureTrend?: string | null;
  windSpeed?: string;
  windDirection?: string;
  probabilityOfPrecipitation?: { unitCode?: string; value: number | null } | null;
  shortForecast: string;
  detailedForecast?: string;
};

export type ForecastPeriod = { name: string; start: string; end: string; short: string; precipChance: number | null };

export type ForecastSummary = {
  snow: { expected: boolean; firstPeriod?: string; inches?: number | null; detail: string };
  rain: { expected: boolean; periods: string[]; detail: string };
  periods: ForecastPeriod[];
};

const SNOW_RE = /snow|flurries|wintry|sleet|blizzard/i;
const RAIN_RE = /rain|showers|thunderstorm|drizzle/i;
const RAIN_CHANCE_MIN = 50;

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** Pulls snow accumulation (upper bound) out of NWS text, e.g. "New snow accumulation of 2 to 4 inches". */
export function parseSnowInches(text: string): number | null {
  const t = text.toLowerCase();
  const range = t.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*inch/);
  if (range) return Number.parseFloat(range[2]);
  const lessThan = t.match(/less than (?:a |an |one )?(half|\d+(?:\.\d+)?)?(?: of)?(?: an?)? ?inch/);
  if (lessThan) {
    if (lessThan[1] === "half") return 0.5;
    if (lessThan[1]) return Number.parseFloat(lessThan[1]);
    return 1;
  }
  const single = t.match(/(?:around|about|of|up to)?\s*(\d+(?:\.\d+)?|an?|one|two|three|four|five|six)\s+inch/);
  if (single) {
    const v = single[1];
    return WORD_NUM[v] ?? Number.parseFloat(v);
  }
  return null;
}

/** Snow accumulation text is only trusted when it sits near the word "snow"/"accumulation". */
function snowInchesFromPeriod(p: NwsPeriod): number | null {
  const text = p.detailedForecast ?? "";
  const m = text.match(/(?:new )?(?:snow|ice|sleet)[^.]*accumulation[^.]*\./i);
  return m ? parseSnowInches(m[0]) : null;
}

function precipChance(p: NwsPeriod): number | null {
  const v = p.probabilityOfPrecipitation?.value;
  return typeof v === "number" ? v : null;
}

export function summarizeForecast(periods: NwsPeriod[], opts: { days?: number } = {}): ForecastSummary {
  const days = opts.days ?? 3;
  let windowed = periods;
  if (periods.length > 0) {
    const t0 = Date.parse(periods[0].startTime);
    const cutoff = t0 + days * 24 * 3600 * 1000;
    windowed = periods.filter((p) => Date.parse(p.startTime) < cutoff);
  }

  const out: ForecastPeriod[] = windowed.map((p) => ({
    name: p.name,
    start: p.startTime,
    end: p.endTime,
    short: p.shortForecast,
    precipChance: precipChance(p),
  }));

  const text = (p: NwsPeriod) => `${p.shortForecast} ${p.detailedForecast ?? ""}`;

  const snowPeriods = windowed.filter((p) => SNOW_RE.test(text(p)));
  const rainPeriods = windowed.filter((p) => RAIN_RE.test(text(p)) && (precipChance(p) ?? 0) >= RAIN_CHANCE_MIN);

  let inches: number | null = null;
  for (const p of snowPeriods) {
    const i = snowInchesFromPeriod(p);
    if (i !== null) inches = (inches ?? 0) + i;
  }

  const snow: ForecastSummary["snow"] = snowPeriods.length
    ? {
        expected: true,
        firstPeriod: snowPeriods[0].name,
        inches,
        detail: `${snowPeriods.map((p) => `${p.name}: ${p.shortForecast}`).join("; ")}${
          inches !== null ? ` (about ${inches} in. total)` : ""
        }`,
      }
    : { expected: false, detail: `No snow in the next ${days} days.` };

  const rain: ForecastSummary["rain"] = rainPeriods.length
    ? {
        expected: true,
        periods: rainPeriods.map((p) => p.name),
        detail: rainPeriods.map((p) => `${p.name}: ${p.shortForecast} (${precipChance(p)}%)`).join("; "),
      }
    : { expected: false, periods: [], detail: `No likely rain in the next ${days} days.` };

  return { snow, rain, periods: out };
}

/** Ids of jobs whose start time falls inside a period flagged as rainy in the summary. */
export function weatherHoldCandidates(
  jobs: Array<{ id: string; start_at: string | null }>,
  summary: ForecastSummary,
): string[] {
  if (!summary.rain.expected) return [];
  const rainy = new Set(summary.rain.periods);
  const windows = summary.periods
    .filter((p) => rainy.has(p.name))
    .map((p) => [Date.parse(p.start), Date.parse(p.end)] as const);
  return jobs
    .filter((j) => {
      if (!j.start_at) return false;
      const t = Date.parse(j.start_at);
      return Number.isFinite(t) && windows.some(([s, e]) => t >= s && t < e);
    })
    .map((j) => j.id);
}
