/**
 * All site copy lives here so text can be edited without touching components.
 * Headlines are arrays: each entry is one line of the big condensed headline.
 */

import { siteConfig } from "./site-config";

export const content = {
  nav: [
    { label: "Services", href: "/#services" },
    { label: "Why Us", href: "/#why-us" },
    { label: "Get a quote", href: "/quote" },
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
      "We're three local high school students who take yard work seriously. We show up, do the job right, and charge a fair price for it.",
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

  quote: {
    cta: "Get a quote",
    headline: ["Get your", "free quote"],
    body: "Tell us about your yard and what you need. We'll look it over and send you a price. No pressure, and you can always call us instead.",
    steps: {
      heading: "What happens next",
      items: [
        "We look at your address and what you asked for.",
        "We send your price by email or text.",
        "You pick a day that works and we show up.",
      ],
    },
    form: {
      /** The form is split into these steps (all shown at once without JavaScript). */
      steps: [
        { label: "Services", title: "What do you need?" },
        { label: "Address", title: "Where's the job?" },
        { label: "Contact", title: "How do we reach you?" },
      ],
      progress: (step: number, total: number) => `Step ${step} of ${total}`,
      next: "Next",
      back: "Back",
      name: { label: "Your name", placeholder: "Jamie Smith" },
      phone: { label: "Phone", placeholder: "(440) 555-0123" },
      email: { label: "Email", placeholder: "you@example.com" },
      street: { label: "Street address", placeholder: "123 Main St" },
      city: { label: "City", placeholder: "Rocky River" },
      state: { label: "State", placeholder: "OH" },
      zip: { label: "ZIP", placeholder: "44116" },
      address: {
        label: "Address of the job",
        placeholder: "123 Main St, Rocky River, OH",
        hint: "Where the work will happen.",
        verifyHint: "We'll verify the address.",
      },
      services: {
        hint: "Pick as many as you like.",
      },
      custom: {
        toggle: "Something not listed?",
        label: "Something else?",
        hint: "Tell us about anything that isn't on the list, and roughly how big it is.",
        placeholder: "A hedge that needs trimming, a pile of branches, a patio to sweep...",
      },
      photos: {
        label: "Photos (optional)",
        hint: "Up to 4 photos, 8 MB each.",
        count: (n: number) => (n === 1 ? "1 photo selected" : `${n} photos selected`),
        uploading: "Uploading...",
        uploaded: "Uploaded \u2713",
        failed: "Couldn't upload",
        withForm: "Will be sent with your request",
        retry: "Try uploading again",
        fallbackNote: "We couldn't upload your photos ahead of time, so we'll send them with the form. You can also try again.",
        partialFail: "Some photos didn't upload. Please try again, or choose your photos again, before sending.",
      },
      days: {
        legend: "Days that work for you (optional)",
        hint: "Pick any that suit you.",
      },
      consent: {
        legend: "Stay in touch (optional)",
        email: "Email me updates, seasonal reminders, and offers.",
        sms: "Text me about my jobs and appointments. Message and data rates may apply.",
        snow: "Add me to the snow list so you can reach me when it snows.",
        note: "You can opt out any time. We never share your details.",
      },
      submit: "Send my quote request",
      submitting: "Sending...",
      callInstead: "Rather talk it through?",
      turnstile: "Quick check to make sure you're a person.",
    },
    errors: {
      fix: "Please fix the highlighted fields and try again.",
      photosAgain: "Please add your photos again before sending.",
      generic: `Something went wrong on our end. Please try again, or call us at ${siteConfig.phone.display}.`,
      unavailable: `We can't take online quote requests right now. Please call us at ${siteConfig.phone.display} and we'll get you a price.`,
      rateLimited: `You've sent a few requests in a short time. Please wait a few minutes, or call us at ${siteConfig.phone.display}.`,
      turnstile: "We couldn't confirm the security check. Please try again.",
    },
    thanks: {
      headline: ["Your quote", "is on the way"],
      body: "Thanks! We've got your request and we're taking a look. We'll send your price as soon as it's ready.",
      nextHeading: "What happens next",
      next: [
        "We look at your address and what you asked for.",
        "We send your price by email or text.",
        "Say yes, pick a day, and we'll take care of the rest.",
      ],
      soonerPrompt: "Need it sooner? Call the crew.",
      back: "Back to home",
    },
    unsubscribe: {
      doneTitle: ["You're", "unsubscribed"],
      doneBody:
        "We've stopped our emails and texts to you, and taken you off the snow list. You may still get a message about a job you've already booked.",
      invalidTitle: ["That link", "didn't work"],
      invalidBody: `We couldn't find that unsubscribe link. It may be out of date. Call us at ${siteConfig.phone.display} and we'll take care of it right away.`,
      errorTitle: ["Something", "went wrong"],
      errorBody: `We couldn't update your preferences just now. Please try the link again in a minute, or call us at ${siteConfig.phone.display}.`,
      changedMind: "Changed your mind? Give us a call and we'll add you back.",
    },
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
