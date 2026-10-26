/**
 * All site copy lives here so text can be edited without touching components.
 * Headlines are arrays: each entry is one line of the big headline.
 * Eyebrows are the small letterspaced labels between thin rules above section and page headings.
 */

import { siteConfig } from "./site-config";

export const content = {
  nav: [
    { label: "Services", href: "/#services" },
    { label: "Commercial", href: "/#commercial" },
    { label: "How it works", href: "/#how-it-works" },
    { label: "Why us", href: "/#why-us" },
    { label: "Contact", href: "/#contact" },
  ],

  cta: {
    call: `Call ${siteConfig.phone.display}`,
    callShort: "Call now",
    contact: "Contact us",
    // The site's main action. Calling is still offered everywhere, just never louder than this.
    quote: "Get my free quote",
    quoteShort: "Free quote",
    callAlt: "Rather talk?",
  },

  hero: {
    kicker: { name: siteConfig.name, place: "Northeast Ohio" },
    // The business's main offer. Swap seasonally (e.g. ["Snow", "removal"] in December).
    headline: ["Fall lawn", "cleanup"],
    body: "Leaf removal, edging, and gutter cleaning in one visit. We get your lawn ready to survive the winter so it bounces back stronger in spring.",
    quoteNote: "Free, no obligation. Takes about two minutes.",
    quickStartLabel: "Or start with what you need",
    // Shortcuts into the quote form with that service already ticked.
    quickStart: [
      { label: "Fall cleanup", slug: "fall-cleanup" },
      { label: "Mowing", slug: "lawn-mowing" },
      { label: "Leaves", slug: "leaf-removal" },
      { label: "Gutters", slug: "gutter-cleaning" },
      { label: "Snow", slug: "snow-removal" },
    ],
    trust: ["Locally owned and operated", "Clear, upfront pricing", "Great reviews from local customers"],
    trustLabel: "Why customers hire us",
    image: {
      src: "/images/hero-leaf-blowing.jpg",
      alt: "A crew member with a backpack blower sending a wave of red fall leaves across a lawn",
    },
  },

  howItWorks: {
    eyebrow: "How it works",
    headline: ["Your price", "in three steps"],
    steps: [
      { title: "Tell us what you need", body: "Pick your services and add your address. It takes about two minutes." },
      { title: "Get your price", body: "We look it over and send you a fair price by text or email. No pressure." },
      { title: "Pick a day", body: "Say yes, choose a day that works, and we show up and get it done." },
    ],
  },

  services: {
    eyebrow: "Services",
    headline: ["Property care,", "handled"],
    intro:
      "Pick what you need, from a single service to the whole property, and we'll take care of it. Our own crew handles every job, start to finish.",
    featuredSlug: "fall-cleanup",
    featuredLabel: "In season now",
    includesLabel: "Includes",
    // Above the rest of the services, under the in-season one.
    moreLabel: "Also on the list",
    linkLabel: "Get a price",
  },

  // On the home page this shares a section with `seasons`: the body is its intro, the pills a line under it.
  benefits: {
    headline: ["One crew", "covers it"],
    body: "From the first mow in spring to the last snowfall, one crew handles the whole yard. Tell us what you need and we'll send you one price for all of it.",
    pills: ["Leaf Cleanup", "Edging", "Gutter Cleaning", "Snow Removal", "And More"],
  },

  // Bigger accounts. Keeps id="commercial" so the nav link lands here.
  commercial: {
    eyebrow: "Commercial & HOA",
    headline: ["Commercial", "& HOA care"],
    intro: `We look after storefronts, offices, and HOA common areas in ${siteConfig.serviceArea.summary}. One crew, one point of contact, one invoice.`,
    points: [
      { title: "Scheduled maintenance", body: "Mowing, trimming, and edging on a set schedule, so the grounds always look cared for." },
      { title: "Seasonal cleanups", body: "Leaves cleared from lawns, beds, and gutters before winter sets in." },
      { title: "Snow removal", body: "Walkways and entrances cleared after the snow." },
      { title: "Simple billing", body: "One quote for the property, invoiced to your business or association." },
    ],
    cta: "Get a commercial quote",
    callPrompt: "Rather walk the property with us first?",
  },

  whyUs: {
    eyebrow: "Why us",
    headline: ["Local crew.", "Real work."],
    paragraphs: [
      "We're a local crew that takes property care seriously. We show up when we say we will, do the job right, and charge a fair price for it.",
      "There's a good chance you've already seen our work. Our customers keep recommending us to friends and neighbors.",
    ],
    points: [
      { title: "Quality work", body: "Crisp edges, clean beds, and no leaves left in the corners." },
      { title: "Fair prices", body: "A clear, honest price before any work starts." },
      { title: "Well reviewed", body: "Lots of happy customers across the area." },
    ],
  },

  seasons: {
    eyebrow: "Year-round",
    headline: ["Three seasons.", "One crew."],
    linkLabel: (title: string) => `Get a ${title.toLowerCase()} quote`,
    items: [
      {
        season: "Spring & Summer",
        title: "Mowing",
        body: "Regular mowing, trimming, and edging from the first cut to the last.",
        serviceSlug: "lawn-mowing",
        image: {
          src: "/images/mower-lawn.jpg",
          alt: "A push mower low in the grass, mid-cut, with a clean stripe of short lawn behind it",
        },
      },
      {
        season: "Fall",
        title: "Cleanup",
        body: "Leaves out of the lawn, beds, and gutters before the ground freezes.",
        serviceSlug: "fall-cleanup",
        image: {
          src: "/images/fall-leaves-lawn.jpg",
          alt: "Oak leaves in rust and gold blanketing a green lawn",
        },
      },
      {
        season: "Winter",
        title: "Snow removal",
        body: "Driveways and walkways cleared after the snow.",
        serviceSlug: "snow-removal",
        image: {
          src: "/images/snow-driveway.jpg",
          alt: "A snowblower clearing a fresh lane down a long, snowy driveway",
        },
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

  // Closing section on the home page. Keeps id="contact" so "Contact" links still land here.
  finalCta: {
    headline: ["Ready for", "your price?"],
    body: "Tell us about your yard and we'll send you a fair price by text or email. Free, and no obligation.",
    // The small label above the headline.
    cardHeading: "Get your free quote",
    points: ["Takes about two minutes", "Price by text or email", "Pick a day that works for you"],
    callPrompt: "Rather talk it through? Call the crew.",
    areaHeading: "Where we work",
  },

  contactPage: {
    eyebrow: "Northeast Ohio",
    headline: ["Contact", "us"],
    body: "One call is all it takes. Tell us what your yard needs and we'll give you a price.",
  },

  quote: {
    cta: "Get a quote",
    eyebrow: "No obligation",
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
        placeholder: "Hedges to trim, brush or branches to haul away, a bigger one-time cleanup...",
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
      eyebrow: "Request received",
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
      // Shown instead when someone backs out of Stripe Checkout (?cancelled=1).
      cancelled: {
        eyebrow: "Payment not finished",
        headline: ["No charge", "was made"],
        body: "You left checkout before paying, so nothing was charged. The link in your quote email works until the quote expires, so you can finish any time, or give us a call.",
        prompt: "Questions about your quote? Call the crew.",
      },
    },
    // After Stripe Checkout succeeds (/quote/paid).
    paid: {
      eyebrow: "You're all set",
      headline: ["Payment", "received"],
      body: "Thank you! Your payment went through and your spot is saved. We'll be in touch soon to schedule your job, and a receipt from Stripe is on its way to your email.",
      callPrompt: "Need to change something or have a question? Give us a call.",
    },
    // A pay link that's past its date or already paid (/quote/expired).
    expired: {
      eyebrow: "Quote link",
      headline: ["That quote", "has expired"],
      body: "Quote links stay active for a couple of weeks. This one has passed its date, or it was already paid. Give us a call and we'll send a fresh quote right away.",
    },
    unsubscribe: {
      eyebrow: "Your preferences",
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

  menu: {
    open: "Open menu",
    title: "Menu",
  },

  mobileBar: {
    quote: "Free quote",
    call: "Call",
    callNow: "Call now",
  },

  footer: {
    blurb: "Lawn care, fall cleanup, gutters, and snow removal from a local crew that does it right.",
    servingLine: "Serving Northeast Ohio",
    linksHeading: "Explore",
    contactHeading: "Get in touch",
    areaHeading: "Service area",
  },

  seo: {
    title: `${siteConfig.name} | Lawn Care, Fall Cleanup & Snow Removal in Northeast Ohio`,
    description:
      "Lawn care, fall cleanup, gutters, and snow removal for homes, businesses, and HOAs in Rocky River, Westlake, Bay Village, and Lakewood. Locally owned, with upfront pricing.",
  },
} as const;
