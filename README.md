# Emmett's Property Services: website

Conversion-focused marketing site for Emmett's Property Services (Emmett's Lawn Care), Rocky River, OH.
Every section pushes toward one of two actions: **book a service** or **call (440) 823-5545**.

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · react-hook-form + zod · Supabase · Vercel

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values
npm run dev                  # http://localhost:3000
```

Without Supabase keys the whole site still works; submitting the form shows a friendly
"please call us" message instead of saving.

## Where to edit things

| What | File |
| --- | --- |
| Phone, email, hours, pricing, service area (TODOs live here) | `lib/site-config.ts` |
| All the words on the site | `lib/content.ts` |
| The list of services (cards, dropdown, validation, SEO) | `lib/services.ts` |
| Photos and logo | `public/images/` and `public/logo.png`; see `public/images/README.md` |
| Colors, fonts, sizes | `tailwind.config.ts`, `app/globals.css` |

The hero headline is the current seasonal offer (`content.hero.headline`). Swap it to
`["Snow", "removal"]` in winter, and change `content.services.featuredSlug` to match.

### Before launch checklist

- [ ] Replace `public/logo.png` with the real badge
- [ ] Replace the photos in `public/images/` (same filenames)
- [ ] Fill in the `TODO`s in `lib/site-config.ts`: email, hours, pricing, and the suburbs you serve
- [ ] Set up Supabase (below) and add the env vars in Vercel
- [ ] Set `NEXT_PUBLIC_SITE_URL` once you have a domain

## Supabase (booking submissions)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste in `supabase/migrations/20260915000000_create_bookings.sql`, and run it.
   This creates the `bookings` table with row level security **on and no public policies**,
   so nobody can read or write it with the public key.
3. From **Project Settings → API**, copy the project URL and the **service_role** key into
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (in `.env.local` and in Vercel).

The form posts to a server action (`app/actions/booking.ts`) that re-validates everything with the same
zod schema the browser uses, drops obvious bots via a hidden honeypot field, and inserts with the
service-role key on the server. The key never reaches the browser.

New bookings show up in **Table Editor → bookings**. The `status` column (`new` → `contacted` →
`scheduled` → `done`) is there for the crew to track jobs.

**Want a text or email when someone books?** Add a Supabase Database Webhook on `bookings` inserts
pointed at an email/SMS service. Not wired in yet.

## Deploy (Vercel)

1. Push this folder to a GitHub repo and import it in Vercel (framework preset: Next.js).
2. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and (optionally) `NEXT_PUBLIC_SITE_URL`
   under **Settings → Environment Variables**.
3. Deploy. `/` and `/book` are statically generated; the booking action runs as a serverless function.

## What's in here

- **Sections** (`components/sections/`): hero, services grid, benefits pills, why us, seasons band,
  booking. `/book` reuses the booking section with an `<h1>`. (A customer reviews section was
  removed; it's in the first commit's history if you want it back once you have real reviews.)
- **Brand shapes** (`components/site/`): `Diagonal` (clip-path panels), `OvalPhoto` (3:4 ellipse
  frame), `PillList` (the flyer's black pills), `Headline` (condensed caps).
- **Phones:** a sticky bottom bar keeps *Call now* and *Book* one tap away at any scroll position.
- **Service links** go to `/?service=<slug>#book` and preselect that service in the dropdown.
- **SEO:** metadata + Open Graph (`app/opengraph-image.tsx` generates the share card), a
  `LocalBusiness` JSON-LD block (`components/site/json-ld.tsx`), `robots.txt`, and `sitemap.xml`.
- **Accessibility:** semantic headings, skip link, visible focus rings, labelled form fields with
  inline errors, alt text on every image, and `prefers-reduced-motion` disables all animation.
- **Motion:** CSS-only hero entrance, plus a tiny IntersectionObserver reveal
  (`components/site/reveal.tsx`). No animation libraries.
