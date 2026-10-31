/**
 * The one list of services. Service rows on the home page, the quote form's checkboxes, the
 * booking validation, and the search-engine data all read from here — add or edit a service once
 * and it shows up everywhere on the site.
 *
 * The back end has its own copy in `public.services` (pricing rules, crew size, whether the quote
 * engine prices it or the owner does). Slugs must match: when you add a service here, add a row in
 * a new `supabase/migrations/` file too (see `20261031001900_more_services.sql` for the shape).
 * `lib/services.test.ts` fails if a slug is missing from the migrations.
 */

export type ServiceIcon =
  | "leaf"
  | "sprout"
  | "wind"
  | "house"
  | "snowflake"
  | "edge"
  | "weed"
  | "mulch"
  | "shrub"
  | "shovel"
  | "tree"
  | "water"
  | "truck";

/** `all` = offered year-round. */
export type Season = "spring-summer" | "fall" | "winter" | "all";

/** How services are grouped on the home page and the quote form. */
export type ServiceGroupSlug = "lawn" | "beds" | "seasonal" | "exterior";

export type ServiceGroup = {
  slug: ServiceGroupSlug;
  title: string;
  /** One line under the group heading. */
  blurb: string;
};

export type Service = {
  slug: string;
  title: string;
  blurb: string;
  icon: ServiceIcon;
  season: Season;
  group: ServiceGroupSlug;
  /** Short list shown on the featured card. */
  includes?: readonly string[];
};

/** Group order on the page. */
export const serviceGroups = [
  { slug: "lawn", title: "Lawn care", blurb: "The regular work that keeps the yard sharp." },
  { slug: "beds", title: "Beds, shrubs & trees", blurb: "Planting beds and the greenery around the house." },
  { slug: "seasonal", title: "Seasonal cleanups", blurb: "Leaves in the fall, snow in the winter." },
  { slug: "exterior", title: "Pressure washing & hauling", blurb: "The outside of the house, and getting rid of what you don't want." },
] as const satisfies readonly ServiceGroup[];

export const services = [
  // ---- Seasonal cleanups ----
  {
    slug: "fall-cleanup",
    title: "Fall Lawn Cleanup",
    blurb:
      "Leaf removal, edging, and gutter cleaning. Gets your lawn ready to survive winter and bounce back stronger in spring.",
    icon: "leaf",
    season: "fall",
    group: "seasonal",
    includes: ["Leaf removal", "Edging", "Gutter cleaning"],
  },
  {
    slug: "leaf-removal",
    title: "Leaf Blowing & Removal",
    blurb: "Leaves blown out of the lawn, beds, and corners, and cleared away.",
    icon: "wind",
    season: "fall",
    group: "seasonal",
  },
  {
    slug: "gutter-cleaning",
    title: "Gutter Cleaning",
    blurb: "Clogged gutters cleared out so rain and snowmelt drain away from the house.",
    icon: "house",
    season: "fall",
    group: "seasonal",
  },
  {
    slug: "snow-removal",
    title: "Snow Removal",
    blurb: "Driveways and walkways cleared so you can get out the door.",
    icon: "snowflake",
    season: "winter",
    group: "seasonal",
  },

  // ---- Lawn care ----
  {
    slug: "lawn-mowing",
    title: "Lawn Mowing & Maintenance",
    blurb: "Recurring mowing, trimming, and edging so the yard looks sharp all season.",
    icon: "sprout",
    season: "spring-summer",
    group: "lawn",
  },
  {
    slug: "edging",
    title: "Edging",
    blurb: "A clean, crisp line along driveways, walks, and beds.",
    icon: "edge",
    season: "spring-summer",
    group: "lawn",
  },
  {
    slug: "weeding",
    title: "Weeding",
    blurb: "Weeds pulled from beds, borders, and the cracks in walks and drives.",
    icon: "weed",
    season: "spring-summer",
    group: "lawn",
  },

  // ---- Beds, shrubs & trees ----
  {
    slug: "mulching",
    title: "Mulching",
    blurb: "Beds edged, weeded, and topped with fresh mulch so they look finished and hold moisture.",
    icon: "mulch",
    season: "spring-summer",
    group: "beds",
  },
  {
    slug: "bush-trimming",
    title: "Bush & Shrub Trimming",
    blurb: "Hedges, bushes, and shrubs shaped and cut back, with the clippings cleared away.",
    icon: "shrub",
    season: "spring-summer",
    group: "beds",
  },
  {
    slug: "shrub-removal",
    title: "Shrub & Bush Removal",
    blurb: "Overgrown or dead shrubs dug out, roots and all, and hauled off.",
    icon: "shovel",
    season: "all",
    group: "beds",
  },
  {
    slug: "tree-trimming",
    title: "Light Tree Trimming",
    blurb: "Low branches and small limbs trimmed back from the house, walks, and driveway. Ground-level work only.",
    icon: "tree",
    season: "all",
    group: "beds",
  },

  // ---- Pressure washing & hauling ----
  {
    slug: "pressure-washing",
    title: "Pressure Washing",
    blurb: "Driveways, walks, patios, decks, and siding washed clean of dirt, moss, and grime.",
    icon: "water",
    season: "spring-summer",
    group: "exterior",
  },
  {
    slug: "junk-removal",
    title: "Junk Removal",
    blurb: "Yard waste, old furniture, and the garage pile loaded up and hauled away.",
    icon: "truck",
    season: "all",
    group: "exterior",
  },
] as const satisfies readonly Service[];

export type ServiceSlug = (typeof services)[number]["slug"];

export const serviceSlugs = services.map((s) => s.slug) as [ServiceSlug, ...ServiceSlug[]];

export function getService(slug: string | null | undefined): Service | undefined {
  return services.find((s) => s.slug === slug);
}

export function isServiceSlug(value: string | null | undefined): value is ServiceSlug {
  return serviceSlugs.includes(value as ServiceSlug);
}

export function getServiceGroup(slug: string | null | undefined): ServiceGroup | undefined {
  return serviceGroups.find((g) => g.slug === slug);
}

/**
 * Services in page order: each group (in `serviceGroups` order) with its services in the order
 * they're listed above. Groups with nothing in them are left out. Pass `omit` to leave out a
 * service that's shown somewhere else on the page (the featured one). A service with no known
 * group (one the owner added in the database only) lands in a final group with no heading.
 */
export function groupServices<T extends { slug: string; group?: string }>(
  list: readonly T[],
  omit?: string,
): Array<{ group: ServiceGroup | null; services: T[] }> {
  const kept = list.filter((s) => s.slug !== omit);
  const out: Array<{ group: ServiceGroup | null; services: T[] }> = [];
  for (const group of serviceGroups) {
    const inGroup = kept.filter((s) => s.group === group.slug);
    if (inGroup.length) out.push({ group, services: inGroup });
  }
  const other = kept.filter((s) => !getServiceGroup(s.group));
  if (other.length) out.push({ group: null, services: other });
  return out;
}
