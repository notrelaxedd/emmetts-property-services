/**
 * All site copy lives here so text can be edited without touching components.
 * Headlines are arrays: each entry is one line of the big condensed headline.
 */

import { siteConfig } from "./site-config";

export const content = {
  nav: [
    { label: "Services", href: "/#services" },
    { label: "Why Us", href: "/#why-us" },
    { label: "Contact", href: "/#contact" },
  ],

  cta: {
    call: `Call ${siteConfig.phone.display}`,
    callShort: "Call now",
    contact: "Contact us",
  },

  hero: {
    kicker: { name: siteConfig.altName, place: "Rocky River, Ohio" },
    // The business's main offer. Swap seasonally (e.g. ["Snow", "removal"] in December).
    headline: ["Fall lawn", "cleanup"],
    body: "Leaf removal, edging, and gutter cleaning in one visit. We get your lawn ready to survive the winter so it bounces back stronger in spring.",
    trust: ["Three-person local crew", "Fair prices", "Great reviews around the neighborhood"],
    image: {
      src: "/images/hero-leaf-blowing.jpg",
      alt: "A crew member with a backpack blower sending a wave of red fall leaves across a lawn",
    },
  },

  services: {
    headline: ["Yard work,", "handled"],
    intro:
      "Pick what you need and we'll take care of it. Every job is done by the same three of us, start to finish.",
    featuredSlug: "fall-cleanup",
    featuredLabel: "In season now",
    linkLabel: "Ask about this",
  },

  benefits: {
    headline: ["One call", "covers it"],
    body: "From the first mow in spring to the last snowfall, one crew handles the whole yard. Tell us what you need and we'll take it from there.",
    pills: ["Leaf Cleanup", "Edging", "Gutter Cleaning", "Snow Removal", "And More"],
    image: {
      src: "/images/fall-leaves-lawn.jpg",
      alt: "Oak leaves in rust and gold blanketing a green lawn",
    },
  },

  whyUs: {
    headline: ["Local students.", "Real work."],
    paragraphs: [
      `We're ${siteConfig.team[0]}, ${siteConfig.team[1]}, and ${siteConfig.team[2]}, three local high school students who take yard work seriously. We show up, do the job right, and charge a fair price for it.`,
      "There's a good chance you've already seen our work. Plenty of the neighborhood has, and they keep telling their neighbors about us.",
    ],
    points: [
      { title: "Quality work", body: "Crisp edges, clean beds, and no leaves left in the corners." },
      { title: "Fair prices", body: "An honest price for the job, every time." },
      { title: "Neighborhood reviewed", body: "Lots of happy customers nearby. Ask around." },
    ],
    image: {
      src: "/images/mower-lawn.jpg",
      alt: "A push mower low in the grass, mid-cut, with a clean stripe of short lawn behind it",
    },
  },

  seasons: {
    headline: ["Three seasons.", "One crew."],
    items: [
      {
        season: "Spring & Summer",
        title: "Mowing",
        body: "Regular mowing, trimming, and edging from the first cut to the last.",
        icon: "sprout",
        serviceSlug: "lawn-mowing",
      },
      {
        season: "Fall",
        title: "Cleanup",
        body: "Leaves out of the lawn, beds, and gutters before the ground freezes.",
        icon: "leaf",
        serviceSlug: "fall-cleanup",
      },
      {
        season: "Winter",
        title: "Snow removal",
        body: "Driveways and walkways cleared with a snowblower.",
        icon: "snowflake",
        serviceSlug: "snow-removal",
      },
    ],
  },

  contact: {
    headline: ["Let's talk", "about your yard"],
    body: "Give us a call. We'll come take a look, tell you what it costs, and pick a day that works for you.",
    callPrompt: "Call the crew",
    handyHeading: "Handy to have when you call",
    handy: ["Your address", "Which service you need", "A day or two that works for you"],
    areaHeading: "Where we work",
  },

  contactPage: {
    headline: ["Contact", "us"],
    body: "One call is all it takes. Tell us what your yard needs and we'll give you a price.",
  },

  mobileBar: {
    call: "Call now",
    contact: "Contact",
  },

  footer: {
    blurb: "Lawn care, fall cleanup, gutters, and snow removal from three local students who do it right.",
    linksHeading: "Explore",
    contactHeading: "Get in touch",
    areaHeading: "Service area",
  },

  seo: {
    title: `${siteConfig.name} | Lawn Care, Fall Cleanup & Snow Removal in Rocky River, OH`,
    description:
      "Lawn mowing, fall leaf cleanup, gutter cleaning, and snow removal in Rocky River and Cleveland's west-side suburbs. Three-person local crew, fair prices, great neighborhood reviews.",
  },
} as const;
