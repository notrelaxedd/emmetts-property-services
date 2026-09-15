/**
 * All site copy lives here so text can be edited without touching components.
 * Headlines are arrays: each entry is one line of the big condensed headline.
 */

import { siteConfig } from "./site-config";

export const content = {
  nav: [
    { label: "Services", href: "/#services" },
    { label: "Why Us", href: "/#why-us" },
    { label: "Reviews", href: "/#reviews" },
    { label: "Contact", href: "/#contact" },
  ],

  cta: {
    book: "Book Now",
    call: `Call ${siteConfig.phone.display}`,
    callShort: "Call",
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
    linkLabel: "Book this",
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

  reviews: {
    headline: ["What the", "neighbors say"],
    // TODO: replace these placeholders with real reviews (with the customer's permission).
    // Don't make up names or quotes — use exactly what customers said.
    items: [
      {
        quote: "PLACEHOLDER — paste a real customer review here. Two or three sentences reads best.",
        name: "PLACEHOLDER — Customer first name",
        detail: "PLACEHOLDER — Street or neighborhood",
      },
      {
        quote: "PLACEHOLDER — a second real review, ideally about a different service (mowing, gutters, snow).",
        name: "PLACEHOLDER — Customer first name",
        detail: "PLACEHOLDER — Street or neighborhood",
      },
      {
        quote: "PLACEHOLDER — a third real review. Mentioning the crew by name makes it feel personal.",
        name: "PLACEHOLDER — Customer first name",
        detail: "PLACEHOLDER — Street or neighborhood",
      },
    ],
  },

  booking: {
    headline: ["Book your", "service"],
    body: "Tell us what you need and when works for you. We'll call you back to confirm the details and give you a price.",
    steps: [
      { title: "Send the form", body: "Takes about a minute." },
      { title: "We call you back", body: "To confirm the job, the day, and the price." },
      { title: "We do the work", body: "And leave the yard cleaner than we found it." },
    ],
    callPrompt: "Rather just talk?",
    callLine: "Call us",
    form: {
      name: { label: "Your name", placeholder: "First and last name" },
      email: { label: "Email", placeholder: "you@example.com" },
      phone: { label: "Phone", placeholder: "(440) 555-0123" },
      address: { label: "Street address", placeholder: "Street, city" },
      service: { label: "Service", placeholder: "Choose a service" },
      date: { label: "Preferred date" },
      notes: {
        label: "Anything we should know?",
        optional: "Optional",
        placeholder: "Gate code, dog in the yard, corner lot, anything that helps",
      },
      submit: "Request my booking",
      submitting: "Sending…",
      fallback: "Or just call us at",
    },
    success: {
      title: "Got it. Thanks!",
      body: (name: string, phone: string, service: string) =>
        `Thanks, ${name}. We'll call you at ${phone} to confirm your ${service.toLowerCase()} and set a time.`,
      sooner: "Need us sooner? Call",
      again: "Book another service",
    },
    errors: {
      generic: `Something went wrong sending your request. Please try again, or just call us at ${siteConfig.phone.display}.`,
      notConfigured: `Online booking isn't switched on yet. Please call us at ${siteConfig.phone.display} and we'll get you scheduled.`,
    },
  },

  bookPage: {
    headline: ["Book a", "service"],
    body: "A minute on this form and one of us will call you back to lock in a day and a price.",
  },

  mobileBar: {
    call: "Call now",
    book: "Book",
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
