# Emmett's Property Services: website

Marketing site for Emmett's Property Services (Emmett's Lawn Care), Northeast Ohio.
Every section pushes toward one action: **the free quote form at `/quote`**. The phone number
(440) 823-5545 is still on every page, just never louder than the quote button.

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Vercel · Supabase · Stripe · Anthropic

The marketing site is still static and phone-first. On top of it sits an **operations system**
(see `docs/BOOKING.md` for the quote → calendar → phone call → pay-after flow, plus `docs/PLAN.md`,
`docs/AUDIT.md`, `docs/ENV.md`, `docs/STRIPE.md`):

| Where | What |
| --- | --- |
| `/quote` | Public quote form: services, "something else?" + photos, preferred days, consent. Creates a customer + lead and queues a quote task; the thanks page says we'll call. |
| `/admin` | Owner console. **Approval inbox** (custom requests, "call <customer> to confirm" cards, follow-ups, crew changes, drops, weather holds, AI cap), Ads, Leads, Quotes (live pricing, payment collected after the job: record cash / check or email a card link), **Schedule** (estimated quotes wait on the "Needs a day" rail; drag one onto the calendar → crew emailed Available / Can't → call the customer → book it with the payment method they named), Availability, Employees + cash payouts, flyer workers, Customers + price log, Money ("Add a paid job" records a job that's already done and paid, straight onto the numbers), Autopilot rules, Fleet status. |
| `/crew` | Mobile crew app (installable PWA): today's jobs, offers ("are you free?" yes / no), swap / drop, start / complete with hours + photos, weekly hours with multiple blocks per day, time off & extra days, pay. |
| `/respond/<token>` | The one-tap links in a crew availability email (no login): I'm available / Can't make it. |
| `/f/<code>` | A flyer worker's QR code: logs the scan, remembers the code for 60 days, lands on `/quote` so the lead is credited to them (`lib/flyers/`). |
| `/api/stripe/webhook` | Stripe Checkout (test mode) → the quote and its job are marked paid (the card link is emailed after the job). |
| `lib/pricing.ts`, `lib/scheduler/` | Pure, unit-tested pricing and greedy scheduling (the scheduler only places jobs by itself when `settings.auto_schedule` is on). |
| `lib/ops/booking.ts`, `lib/ops/crew-offers.ts` | Place a job, poll the crew by email, confirm by phone, pay after. |
| `lib/ai/claude.ts` | The only place that calls the Anthropic API: ad drafts, customer messages, custom-request summaries, tree-cover estimates. Every call is logged to `ai_usage` and capped monthly. |
| `supabase/migrations/` | Schema, RLS (crew never see prices or customer contact details), task queue (`claim_task` with `SKIP LOCKED`), seed. |
| `fleet/` | One Node 22 worker binary for the Debian boxes (`ads`, `quotes`, `scheduler`, `followup`, `host`) + systemd units. Workers talk only to Supabase. |

Everything AI-written or customer-facing lands in the approval inbox first; autopilot rules are all off by default.
No customer is emailed a price or asked for money before the owner has called them.

## Run it locally

```bash
npm install
cp .env.example .env.local   # Supabase + Anthropic (+ Stripe test keys); the public site works with none of them
npm run dev                  # http://localhost:3000
npm test                     # unit tests
npm run test:db              # migrations + RLS against a local Postgres (supabase/README.md)
npm run test:e2e             # Playwright smoke tests (set PLAYWRIGHT_CHROMIUM_PATH to reuse a system Chromium)
```

## Where to edit things

| What | File |
| --- | --- |
| Phone, email, hours, pricing, service area (TODOs live here) | `lib/site-config.ts` |
| All the words on the site | `lib/content.ts` |
| The list of services (in-season panel, service rows, quote form, SEO) | `lib/services.ts` |
| Photos and logo | `public/images/`, `public/logo.png` and `public/logo-light.png`; see `public/images/README.md` |
| Flyer design (words, layout) + where the QR code goes | `assets/flyer/fall-cleanup.html`, then `npm run flyer:template` (re-renders `fall-cleanup.webp` at 300 dpi and prints the box to paste into `FLYER_TEMPLATE` in `lib/flyers/render.ts`) |
| Colors, fonts, sizes | `tailwind.config.ts`, `app/globals.css` |

The hero headline is the current seasonal offer (`content.hero.headline`). Swap it to
`["Snow", "removal"]` in winter, and change `content.services.featuredSlug` to match.

### Before launch checklist

- [ ] Replace the two remaining stock photos in `public/images/` (`mower-lawn.jpg`, `snow-driveway.jpg`; same filenames)
- [ ] Fill in the `TODO`s in `lib/site-config.ts`: email, hours, and pricing.
      Email and hours show on the contact page as soon as they're set, and stay hidden until then.
      The towns served and the mailing address (customer email footer) are already set there
- [ ] Set `NEXT_PUBLIC_SITE_URL` once you have a domain (flyer QR codes point at it: set it before printing flyers)

## Deploy (Vercel)

The repo is connected to Vercel, so pushing to `main` deploys automatically and every branch gets a preview.
The public site needs no env vars; the ops system needs the ones in `docs/ENV.md` (Supabase, Anthropic, Stripe
test keys). Apply `supabase/migrations/` to the Supabase project first (`supabase/README.md`), then promote your
own user to `owner`.

**If you change the logo**, also refresh `assets/og/logo-og.png` (a ~520px-wide copy) and, if you ever
swap the headline font, `assets/og/Montserrat-*-Subset.ttf` (ASCII-only static cuts). The share-image function inlines whatever it
loads, and Vercel rejects an edge function over 1 MB — using the full-size logo there breaks the
deploy with "Edge Function size is 1.48 MB". The site's own pages always use the full-size `public/logo.png` / `public/logo-light.png`.
The flyer template has the logo baked in, so run `npm run flyer:template` after a logo change too (its HTML
uses those Montserrat subsets plus `assets/fonts/WorkSans-*-Subset.ttf`, and the code under each QR is set in the 600 cut).

## Canvass (door-to-door)

The **Canvass** tab plans door knocking on foot: county parcels, a knock window and a price *range* per house,
a walking plan for a slot, a phone knock logger, QR door hangers per street and a nightly digest. Data comes only
from the Cuyahoga County parcel layer, Census block-group aggregates, our own knock log and what the crew heard at
the door; see `docs/CANVASS.md` for the privacy rules, the window logic and the first-run field-map procedure.

| Route | Who | What |
| --- | --- | --- |
| `/admin/canvass` | owner | Map area picker, parcel table, nightly summary |
| `/admin/canvass/parcels/[id]` | owner | Parcel detail: quote, lawn tracing, window, knock history |
| `/admin/canvass/plan` | owner | Plan my session |
| `/admin/canvass/hangers` | owner | Hanger codes per street + conversions; `…/hangers/[code]/print` is the 3-up sheet |
| `/admin/canvass/stats` | owner | Knocker / pitch stats, hanger conversions, pitches |
| `/admin/canvass/settings` | owner | Pricing, thresholds, season map, county field map |
| `/crew/knock` | crew + owner | Knock logger (phone) |
| `/h/[code]` | public | Hanger QR landing → `/quote?src=hanger&s=<code>` |
| `/api/cron/canvass-summary` | Vercel cron | Nightly summary (Bearer `CRON_SECRET`) |

## What's in here

- **Sections** (`components/sections/`): hero (quote button + service shortcuts that pre-tick the form),
  how it works, services (the in-season one first, then ruled rows), commercial & HOA, why us, three seasons (which also
  carries the "one crew covers it" line), and a closing quote section on forest green (`quote-cta.tsx`,
  keeps `id="contact"`). `/contact` is still the call-first page (`contact.tsx`), and
  `/book` redirects there.
  (A booking form and a customer reviews section were removed; both are in the git history.)
- **Brand shapes** (`components/site/`), all from the badge: `RingPhoto` (a photo in the thin
  ring), `Eyebrow` / `SectionHeading` (letterspaced label between rules, heavy Montserrat caps),
  `season-glyphs.tsx` (maple, grass, snowflake, and the `GroundLine` divider), `Wordmark`, plus the quiet
  `ArrowLink` and `CallLink` text links. The quote, thanks, paid, expired and unsubscribe pages are built
  from the same pieces; `/contact` is the reference for a non-home page.
- **Phones:** a sticky bottom bar keeps *Free quote* (and *Call*) one tap away at any scroll position.
- **SEO:** metadata + Open Graph (`app/opengraph-image.tsx` generates the share card), a
  `LocalBusiness` JSON-LD block (`components/site/json-ld.tsx`), `robots.txt`, and `sitemap.xml`.
- **Accessibility:** semantic headings, skip link, visible focus rings, alt text on every image,
  and `prefers-reduced-motion` disables all animation.
- **Motion:** CSS-only hero entrance (the ring draws itself in), plus a tiny IntersectionObserver reveal
  (`components/site/reveal.tsx`). No animation libraries.
