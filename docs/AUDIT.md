# Phase 0 — Repo audit

Audit of `emmetts-property-services` before adding the ops system described in `docs/PLAN.md`.

## What exists

| Area | Finding |
| --- | --- |
| Framework | Next.js **14.2.35**, App Router, TypeScript 5 (strict), React 18. `@/*` path alias to repo root. |
| Routing | `app/page.tsx` (home), `app/contact/page.tsx`, `app/opengraph-image.tsx` (edge), `robots.ts`, `sitemap.ts`. `/book` → `/contact` permanent redirect in `next.config.mjs`. **No route groups** — the marketing pages live directly under `app/`. |
| Styling | Tailwind 3.4 + `tailwindcss-animate`. Brand tokens in `tailwind.config.ts` (`brand-green`, `ink`, `paper`, `gray-*`); shadcn semantic tokens (`--background`, `--primary`, …) mapped in `app/globals.css`. Fonts: Anton (display) + Work Sans (body) via `next/font`. |
| shadcn/ui | `components.json` (style `new-york`, base `zinc`, CSS variables, lucide icons). Only **`button`** and **`sheet`** exist in `components/ui/`. Custom button variants `cta`, `cta-outline`, `cta-green`. |
| Site chrome | `components/site/*`: header, footer, mobile nav, sticky mobile call bar, JSON-LD, logo, reveal animation, brand shapes (`Diagonal`, `OvalPhoto`, `PillList`, `Headline`). Root layout wraps **every** route in header + footer + call bar + analytics. |
| Content | All copy in `lib/content.ts`; business facts in `lib/site-config.ts` (phone, TODO email/hours, service area, timezone `America/New_York`, team names); service list in `lib/services.ts` (5 slugs: `fall-cleanup`, `lawn-mowing`, `leaf-removal`, `gutter-cleaning`, `snow-removal`). |
| Forms / DB | **None today.** A booking form + Supabase `bookings` table existed and was removed in commit `6be7c75` ("Replace the booking form with a contact page"). Still in git history and reusable: `lib/supabase/server.ts` (service-role client, `server-only`), `lib/booking-schema.ts` (zod: phone normalisation, `todayISO()`), `app/actions/booking.ts` (server action with honeypot), `components/ui/{form,input,textarea,native-select}.tsx`. |
| Auth | None. |
| Env vars | Only `NEXT_PUBLIC_SITE_URL` (optional). `.env*.local` git-ignored. |
| Deploy | Vercel, auto-deploy from `main`. Edge function size limit already bit once (share image). `@vercel/analytics` + `speed-insights` in layout. |
| Tests / lint | `next lint` only (`next/core-web-vitals` + `next/typescript`). No unit or e2e test runner. |
| Node | Node 22 in this environment; `@types/node` ^20. Fleet workers will target Node 20 LTS per the plan (code is compatible with both). |

## What we can reuse

- Tailwind brand tokens, `cn()`, `Button` variants, `Sheet` (for mobile drawers in `/admin` and `/crew`).
- `lib/services.ts` slugs as the stable `services.slug` seed keys so the marketing cards can deep-link to the quote form (`/quote?service=lawn-mowing`).
- `siteConfig.timezone`, phone formatting + `todayISO()` from the old `booking-schema.ts`.
- The old server-action + honeypot pattern for the quote form; the old `getSupabaseAdmin()` pattern for the service-role client.
- Header/footer/call-bar for the public quote page (they are the brand).

## Conflicts with the plan and how they're resolved

| Plan assumption | Reality | Resolution |
| --- | --- | --- |
| `app/(public)/…` route group | Marketing pages are at `app/*` with the chrome in the root layout. | No URL changes. The marketing pages (`/`, `/contact`, `/quote`) move into an `app/(marketing)/` route group whose layout owns the header, footer, call bar and JSON-LD; the root layout keeps only `<html>`, fonts, global CSS and analytics. `/admin`, `/crew` and `/login` get their own layouts without the marketing chrome. Verified with `next build` that the three public routes still render. |
| Supabase already in use | Removed in `6be7c75`; no project wired. | Re-add `@supabase/supabase-js` + `@supabase/ssr`. Schema lives in `supabase/migrations/`. Local validation uses Postgres 16 with an `auth` shim (`supabase/test/`). |
| shadcn components available | Only button + sheet; the shadcn registry is **not reachable** from this build environment. | Hand-write the needed `components/ui/*` (input, textarea, label, checkbox, switch, card, badge, tabs, select, table, dialog, separator, toast) in the same new-york style and token set. |
| "EOD Lawns" naming | Business is **Emmett's Property Services** (Rocky River, OH). | Keep the repo's business name everywhere user-facing; "EOD" appears only in `docs/PLAN.md`. |
| Services seed: leaf cleanup, edging, gutter cleaning, mowing, snow removal | Site lists fall-cleanup, lawn-mowing, leaf-removal, gutter-cleaning, snow-removal. | Seed both sets: the five site slugs plus `edging`. `fall-cleanup` is a bundle (leaf removal + edging + gutters). All `auto_quote = true`. |
| Vercel edge size limits | Already hit once. | All new API routes/server actions run on the **Node** runtime (Stripe + Supabase + Anthropic SDKs are not edge-safe anyway). |
| Node 20 on fleet boxes | Environment has Node 22. | Fleet code uses only Node ≥ 20 APIs; `fleet/package.json` sets `engines.node >=20`. |

## Proposed routes

| Route | Role | Notes |
| --- | --- | --- |
| `/` , `/contact` | public | unchanged |
| `/quote` | public | new quote form; `/quote/thanks` confirmation |
| `/login` | public | magic-link / OTP sign-in for owner + crew |
| `/admin` | owner | approval inbox (home) |
| `/admin/ads`, `/admin/leads`, `/admin/quotes/[id]`, `/admin/schedule`, `/admin/availability`, `/admin/employees`, `/admin/customers/[id]`, `/admin/money`, `/admin/autopilot`, `/admin/fleet` | owner | |
| `/crew` | crew | today / offers; `/crew/hours`, `/crew/time-off`, `/crew/jobs/[id]`, `/crew/pay` |
| `/api/stripe/webhook` | Stripe | Node runtime, raw body |
| `/api/auth/callback` | Supabase | PKCE code exchange |

## Unknowns carried as config (never invented)

All in `lib/config.ts` / `settings` table and listed in `docs/ENV.md`: email provider, geocoder, parcel data source, minimum job price, drop-notice hours (default 24), partner tree service, crew login method (both email + phone supported), monthly AI cap.
