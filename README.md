# Emmett's Property Services: website

Marketing site for Emmett's Property Services (Emmett's Lawn Care), Rocky River, OH.
Every section pushes toward one action: **call (440) 823-5545**.

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Vercel

There's no booking form and no database. The site is entirely static: every call to action is either
a `tel:` link or a jump to the contact details.

## Run it locally

```bash
npm install
npm run dev   # http://localhost:3000
```

## Where to edit things

| What | File |
| --- | --- |
| Phone, email, hours, pricing, service area (TODOs live here) | `lib/site-config.ts` |
| All the words on the site | `lib/content.ts` |
| The list of services (cards, seasons band, SEO) | `lib/services.ts` |
| Photos and logo | `public/images/` and `public/logo.png`; see `public/images/README.md` |
| Colors, fonts, sizes | `tailwind.config.ts`, `app/globals.css` |

The hero headline is the current seasonal offer (`content.hero.headline`). Swap it to
`["Snow", "removal"]` in winter, and change `content.services.featuredSlug` to match.

### Before launch checklist

- [ ] Replace the photos in `public/images/` (same filenames)
- [ ] Fill in the `TODO`s in `lib/site-config.ts`: email, hours, pricing, and the suburbs you serve.
      Email and hours show on the contact page as soon as they're set, and stay hidden until then
- [ ] Set `NEXT_PUBLIC_SITE_URL` once you have a domain

## Deploy (Vercel)

The repo is connected to Vercel, so pushing to `main` deploys automatically. `NEXT_PUBLIC_SITE_URL`
is the only environment variable, and it's optional.

## What's in here

- **Sections** (`components/sections/`): hero, services grid, benefits pills, why us, seasons band,
  contact. `/contact` reuses the contact section with an `<h1>`, and `/book` redirects there.
  (A booking form and a customer reviews section were removed; both are in the git history.)
- **Brand shapes** (`components/site/`): `Diagonal` (clip-path panels), `OvalPhoto` (3:4 ellipse
  frame), `PillList` (the flyer's black pills), `Headline` (condensed caps).
- **Phones:** a sticky bottom bar keeps *Call now* one tap away at any scroll position.
- **SEO:** metadata + Open Graph (`app/opengraph-image.tsx` generates the share card), a
  `LocalBusiness` JSON-LD block (`components/site/json-ld.tsx`), `robots.txt`, and `sitemap.xml`.
- **Accessibility:** semantic headings, skip link, visible focus rings, alt text on every image,
  and `prefers-reduced-motion` disables all animation.
- **Motion:** CSS-only hero entrance, plus a tiny IntersectionObserver reveal
  (`components/site/reveal.tsx`). No animation libraries.
