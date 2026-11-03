/**
 * The one list of services. Service cards, the booking dropdown, the booking validation,
 * and the search-engine data all read from here — add or edit a service once and it shows up everywhere.
 */

export type ServiceIcon = "leaf" | "sprout" | "wind" | "house" | "snowflake" | "scissors" | "shovel" | "flower" | "droplets";
export type Season = "spring-summer" | "fall" | "winter";

export type Service = {
  slug: string;
  title: string;
  blurb: string;
  icon: ServiceIcon;
  season: Season;
  /** Short list shown on the featured card. */
  includes?: readonly string[];
};

export const services = [
  {
    slug: "fall-cleanup",
    title: "Fall Lawn Cleanup",
    blurb:
      "Leaf removal, edging, and gutter cleaning. Gets your lawn ready to survive winter and bounce back stronger in spring.",
    icon: "leaf",
    season: "fall",
    includes: ["Leaf removal", "Edging", "Gutter cleaning"],
  },
  {
    slug: "lawn-mowing",
    title: "Weekly Mowing",
    blurb: "Weekly mowing, trimming, and edging so the yard looks sharp all season.",
    icon: "sprout",
    season: "spring-summer",
  },
  {
    slug: "edging",
    title: "Edging",
    blurb: "Crisp, clean lines along driveways, walks, and beds.",
    icon: "scissors",
    season: "spring-summer",
  },
  {
    slug: "mulching",
    title: "Mulching",
    blurb: "Fresh mulch spread in your beds to keep weeds down and the yard looking finished.",
    icon: "shovel",
    season: "spring-summer",
  },
  {
    slug: "bed-cleanout",
    title: "Bed Cleanouts",
    blurb: "Weeds, leaves, and dead growth pulled out of the beds, ready for mulch or planting.",
    icon: "flower",
    season: "spring-summer",
  },
  {
    slug: "bush-trimming",
    title: "Bush Trimming",
    blurb: "Shrubs and hedges shaped and trimmed back, with the clippings hauled away.",
    icon: "scissors",
    season: "spring-summer",
  },
  {
    slug: "pressure-washing",
    title: "Pressure Washing",
    blurb: "Driveways, walkways, patios, and siding washed clean.",
    icon: "droplets",
    season: "spring-summer",
  },
  {
    slug: "leaf-removal",
    title: "Leaf Blowing & Removal",
    blurb: "Leaves blown out of the lawn, beds, and corners, and cleared away.",
    icon: "wind",
    season: "fall",
  },
  {
    slug: "gutter-cleaning",
    title: "Gutter Cleaning",
    blurb: "Clogged gutters cleared out so rain and snowmelt drain away from the house.",
    icon: "house",
    season: "fall",
  },
  {
    slug: "snow-removal",
    title: "Snow Removal",
    blurb: "Driveways and walkways cleared so you can get out the door, on a monthly plan or per push.",
    icon: "snowflake",
    season: "winter",
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
