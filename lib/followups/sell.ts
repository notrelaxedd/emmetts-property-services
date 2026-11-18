/**
 * What to offer a customer right now (Follow-ups tab). Pure: no database, no clock.
 *
 * Rule-based on purpose: the month decides which services are in season, then anything they already have
 * (a mowing schedule, a spot on the snow list) or bought in the last few weeks drops out. A service they booked
 * around this time last year goes to the top.
 */

export type SellIdea = { slug: string; name: string; /** Why this, for the owner. */ why: string };

export type Purchase = { slug: string; /** Local "YYYY-MM-DD". */ on: string };

type Pitch = { name: string; why: string; /** Customer-facing sentence for the message draft. */ line: string };

export const PITCHES: Record<string, Pitch> = {
  "snow-removal": {
    name: "Snow Removal",
    why: "Not on the snow list. Get them signed up before the next storm.",
    line: "We're filling our snow removal list for this winter and I wanted to offer you a spot.",
  },
  "lawn-mowing": {
    name: "Weekly Mowing",
    why: "Not on a mowing schedule. Weekly cuts are the steadiest money.",
    line: "We're setting our weekly mowing schedule and have room on your street.",
  },
  "leaf-removal": { name: "Leaf Removal", why: "Leaves are down right now.", line: "We're doing leaf cleanups in your neighborhood this week." },
  "gutter-cleaning": {
    name: "Gutter Cleaning",
    why: "Gutters fill up once the leaves drop.",
    line: "With the leaves coming down, it's a good time to get your gutters cleaned out.",
  },
  "fall-cleanup": {
    name: "Fall Cleanup",
    why: "One visit: leaves, edging and gutters.",
    line: "We're booking fall cleanups: leaves, edging and gutters in one visit.",
  },
  mulching: { name: "Mulching", why: "Fresh mulch season.", line: "We're booking mulch installs for the next couple of weeks." },
  "bed-cleanout": { name: "Bed Cleanouts", why: "Beds need clearing out this time of year.", line: "We're doing garden bed cleanouts in your area." },
  "bush-trimming": { name: "Bush Trimming", why: "Bushes are overgrown by now.", line: "We're out trimming bushes and hedges in your area." },
  "pressure-washing": {
    name: "Pressure Washing",
    why: "Warm-weather job: driveways, patios, siding.",
    line: "We're booking pressure washing for driveways and patios.",
  },
  aeration: {
    name: "Core Aeration",
    why: "Aerate in fall or spring so the lawn comes back thicker.",
    line: "We're booking lawn aeration (and overseeding if you want it) in your area.",
  },
  overseeding: {
    name: "Overseeding",
    why: "Thin lawns fill in best when seeded right after aeration.",
    line: "We're overseeding lawns to fill in thin spots, best done with aeration.",
  },
  "junk-removal": {
    name: "Junk Removal",
    why: "Spring and fall cleanouts: garages, basements, yard debris.",
    line: "We're hauling away junk and yard debris this week if you have anything to get rid of.",
  },
  edging: { name: "Edging", why: "Easy add-on to any visit.", line: "We can edge the lawn to sharpen everything up." },
};

/** In-season services by month (1 = January), best first. Northeast Ohio. */
export const SEASON: Record<number, string[]> = {
  1: ["snow-removal"],
  2: ["snow-removal", "lawn-mowing", "bed-cleanout"],
  3: ["bed-cleanout", "mulching", "lawn-mowing", "edging"],
  4: ["lawn-mowing", "aeration", "mulching", "bed-cleanout", "junk-removal"],
  5: ["lawn-mowing", "mulching", "bush-trimming", "pressure-washing"],
  6: ["lawn-mowing", "bush-trimming", "pressure-washing", "edging"],
  7: ["bush-trimming", "pressure-washing", "lawn-mowing", "edging"],
  8: ["bush-trimming", "pressure-washing", "lawn-mowing", "edging"],
  9: ["aeration", "overseeding", "fall-cleanup", "bush-trimming"],
  10: ["fall-cleanup", "leaf-removal", "gutter-cleaning", "snow-removal"],
  11: ["leaf-removal", "gutter-cleaning", "snow-removal", "fall-cleanup"],
  12: ["snow-removal", "gutter-cleaning"],
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Bought within this many days: don't offer it again yet. */
const JUST_DID_DAYS = 45;

export function suggestSales(input: {
  today: string;
  onMowing: boolean;
  onSnow: boolean;
  purchases: Purchase[];
  /** Active services by slug → the name to show. Empty = every known service is offered. */
  catalogue?: Map<string, string>;
  max?: number;
}): SellIdea[] {
  const month = Number(input.today.slice(5, 7));
  const offered = (slug: string) => !input.catalogue?.size || input.catalogue.has(slug);
  const ideas: (SellIdea & { rank: number })[] = [];
  (SEASON[month] ?? []).forEach((slug, i) => {
    const pitch = PITCHES[slug];
    if (!pitch || !offered(slug)) return;
    if (slug === "lawn-mowing" && input.onMowing) return;
    if (slug === "snow-removal" && input.onSnow) return;
    const mine = input.purchases.filter((p) => p.slug === slug);
    if (mine.some((p) => daysBetween(p.on, input.today) >= 0 && daysBetween(p.on, input.today) < JUST_DID_DAYS)) return;
    // Around this time last year (9 to 15 months back): the easiest yes there is.
    const lastYear = mine.find((p) => daysBetween(p.on, input.today) >= 270 && daysBetween(p.on, input.today) <= 460);
    ideas.push({
      slug,
      name: input.catalogue?.get(slug) ?? pitch.name,
      why: lastYear ? `They booked this last ${MONTHS[Number(lastYear.on.slice(5, 7)) - 1]}. Ask if they want it again.` : pitch.why,
      rank: lastYear ? i - 100 : i,
    });
  });
  return ideas
    .sort((a, b) => a.rank - b.rank)
    .slice(0, input.max ?? 2)
    .map(({ rank: _rank, ...idea }) => idea);
}
