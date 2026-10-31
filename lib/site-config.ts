/**
 * Business facts in one place. Components, metadata, and the JSON-LD block all read from here.
 *
 * Anything marked TODO is a placeholder. Values set to `null` are hidden on the site until
 * you fill them in, so nothing half-finished shows up in front of customers.
 */

const PHONE_DIGITS = "4408235545";

export const siteConfig = {
  name: "Emmett's Property Services",
  altName: "Emmett's Lawn Care",

  /** Used for canonical URLs and Open Graph. Set NEXT_PUBLIC_SITE_URL in Vercel once you have a domain. */
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"),

  phone: {
    display: "(440) 823-5545",
    href: `tel:+1${PHONE_DIGITS}`,
    e164: `+1${PHONE_DIGITS}`,
  },

  // TODO: add the business email, e.g. "hello@emmettspropertyservices.com". Hidden while null.
  email: null as string | null,

  // TODO: add hours, e.g. "Mon–Sat, 8am–6pm". Hidden while null.
  hours: null as string | null,
  // TODO: matching schema.org hours for search engines, e.g. ["Mo-Sa 08:00-18:00"]. Omitted while empty.
  openingHoursSpec: [] as string[],

  pricing: {
    // TODO: set a price range for Google, e.g. "$" or "$$". Omitted while null.
    priceRange: null as string | null,
    // TODO: a short line shown under the services grid, e.g. "Most yards: $40–$90 per visit." Hidden while null.
    note: null as string | null,
    // TODO: optional "From $X" labels on service cards, keyed by service slug. Hidden while null.
    from: {
      "fall-cleanup": null,
      "leaf-removal": null,
      "gutter-cleaning": null,
      "snow-removal": null,
      "lawn-mowing": null,
      edging: null,
      weeding: null,
      mulching: null,
      "bush-trimming": null,
      "shrub-removal": null,
      "tree-trimming": null,
      "pressure-washing": null,
      "junk-removal": null,
    } as Record<string, string | null>,
  },

  serviceArea: {
    primary: "Rocky River",
    region: "OH",
    regionName: "Ohio",
    summary: "Rocky River, Westlake, Bay Village, and Lakewood",
    // The towns we serve. Used in search-engine data; keep `summary` in step when this changes.
    cities: ["Rocky River", "Westlake", "Bay Village", "Lakewood"] as string[],
  },

  /**
   * Postal address for customer emails (marketing email must carry one by law). Not shown on the
   * website or in search data: it isn't a storefront.
   */
  mailingAddress: "19618 Beach Cliff Blvd, Rocky River, OH 44116",

  /** Timezone used to decide what "today" means for the preferred-date field. */
  timezone: "America/New_York",
} as const;

export type SiteConfig = typeof siteConfig;
