# Emmett's Property Services: website

Marketing site for Emmett's Property Services (Emmett's Lawn Care), Northeast Ohio.
Every section pushes toward one action: **the free quote form at `/quote`**. The phone number
(440) 823-5545 is still on every page, just never louder than the quote button.

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Vercel · Supabase · Stripe · Anthropic

The marketing site is still static and phone-first. On top of it sits an **operations system**
(see `docs/PLAN.md`, `docs/AUDIT.md`, `docs/ENV.md`, `docs/STRIPE.md`):

| Where | What |
| --- | --- |
| `/quote` | Public quote form: services, "something else?" + photos, preferred days, consent. Creates a customer + lead and queues a quote task. |
| `/admin` | Owner console. **Approval inbox** (every outbound action: ads, quotes, custom requests, bookings, follow-ups, crew changes, drops, weather holds, AI cap), Ads, Leads, Quotes (live pricing + Send via Stripe), Schedule (drag to move), Availability, Employees + cash payouts, flyer workers (per-worker QR flyers, conversion, pay per flyer), Customers + price log (who you talked to, about what, the price you gave, when to follow up), Money, Autopilot rules, Fleet status. |
| `/crew` | Mobile crew app (installable PWA): today's jobs, offers (accept / can't), swap / drop, start / complete with hours + photos, weekly hours with multiple blocks per day, time off & extra days, pay. |
| `/f/<code>` | A flyer worker's QR code: logs the scan, remembers the code for 60 days, lands on `/quote` so the lead is credited to them (`lib/flyers/`). |
| `/api/stripe/webhook` | Stripe Checkout (test mode) → paid quote becomes an unscheduled job and the scheduler runs. |
| `lib/pricing.ts`, `lib/scheduler/` | Pure, unit-tested pricing and greedy scheduling. |
| `lib/ai/claude.ts` | The only place that calls the Anthropic API: ad drafts, customer messages, custom-request summaries, tree-cover estimates. Every call is logged to `ai_usage` and capped monthly. |
| `supabase/migrations/` | Schema, RLS (crew never see prices or customer contact details), task queue (`claim_task` with `SKIP LOCKED`), seed. |
| `fleet/` | One Node 22 worker binary for the Debian boxes (`ads`, `quotes`, `scheduler`, `followup`, `host`) + systemd units. Workers talk only to Supabase. |

Everything AI-written or customer-facing lands in the approval inbox first; autopilot rules are all off by default.

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
| The list of services (cards, seasons band, SEO) | `lib/services.ts` |
| Photos and logo | `public/images/` and `public/logo.png`; see `public/images/README.md` |
| Flyer template + where the QR code goes | `assets/flyer/` and `FLYER_TEMPLATE` in `lib/flyers/render.ts` |
| Colors, fonts, sizes | `tailwind.config.ts`, `app/globals.css` |

The hero headline is the current seasonal offer (`content.hero.headline`). Swap it to
`["Snow", "removal"]` in winter, and change `content.services.featuredSlug` to match.

### Before launch checklist

- [ ] Replace the photos in `public/images/` (same filenames)
- [ ] Fill in the `TODO`s in `lib/site-config.ts`: email, hours, pricing, and the suburbs you serve.
      Email and hours show on the contact page as soon as they're set, and stay hidden until then
- [ ] Set `NEXT_PUBLIC_SITE_URL` once you have a domain (flyer QR codes point at it: set it before printing flyers)

## Deploy (Vercel)

The repo is connected to Vercel, so pushing to `main` deploys automatically and every branch gets a preview.
The public site needs no env vars; the ops system needs the ones in `docs/ENV.md` (Supabase, Anthropic, Stripe
test keys). Apply `supabase/migrations/` to the Supabase project first (`supabase/README.md`), then promote your
own user to `owner`.

**If you change the logo**, also refresh `assets/og/logo-og.png` (a ~520px-wide copy) and, if you ever
swap the headline font, `assets/og/Montserrat-*-Subset.ttf` (ASCII-only static cuts). The share-image function inlines whatever it
loads, and Vercel rejects an edge function over 1 MB — using the full-size logo there breaks the
deploy with "Edge Function size is 1.48 MB". The site's own pages always use the full `public/logo.png`.

## What's in here

- **Sections** (`components/sections/`): hero (quote button + service shortcuts that pre-tick the form),
  how it works, services (the in-season one first, then ruled rows), why us, three seasons (which also
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
