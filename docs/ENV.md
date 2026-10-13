# Environment variables

Where each variable lives: **Vercel** (the Next.js site, Settings → Environment Variables), **Fleet** (each Debian
box's `/etc/fleet/<role>.env`, see `fleet/README.md`), or **Local** (`.env.local`, git-ignored). Never prefix a secret
with `NEXT_PUBLIC_`; never commit one.

| Variable | Vercel | Fleet | Required | Purpose |
| --- | :-: | :-: | :-: | --- |
| `NEXT_PUBLIC_SITE_URL` | ✓ | — | prod | Canonical site URL (`https://…`). Used for links in emails, Stripe redirects, sitemap. Falls back to `VERCEL_PROJECT_PRODUCTION_URL`. |
| `SITE_URL` | — | ✓ | ✓ | Same value, for the workers (they never read `NEXT_PUBLIC_*`). |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | — | ✓ | Supabase project URL (browser + server cookie client). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | — | ✓ | Supabase anon key. Safe in the browser; RLS does the gating. |
| `SUPABASE_URL` | ✓ | ✓ | ✓ | Supabase project URL for the service-role client. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | ✓ | **Secret.** Bypasses RLS. Server actions, webhook, workers only. Rotate from Supabase → Settings → API; update Vercel and every box. |
| `ANTHROPIC_API_KEY` | ✓ | ✓ | ✓ | **Secret.** All Claude calls go through `lib/ai/claude.ts`. |
| `ANTHROPIC_MODEL` | ✓ | ✓ | — | Default `claude-sonnet-5-5`. Haiku model ids are refused at startup. |
| `STRIPE_SECRET_KEY` | ✓ | — | ✓ | **Secret.** Use the `sk_test_…` key until the owner approves going live; the code warns loudly on a non-test key. |
| `STRIPE_WEBHOOK_SECRET` | ✓ | — | ✓ | `whsec_…` for `https://www.eodlawns.com/api/stripe/webhook`. `npm run stripe:setup` creates the endpoint with the right events and prints this once (see `docs/STRIPE.md`). Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`. |
| `STRIPE_TAX_ENABLED` | ✓ | ✓ | — | `true` turns on Stripe Tax (`automatic_tax`) for new Checkout sessions and invoices; Checkout then also requires a billing address. **Default off: leave unset until Ohio is registered in Stripe Tax** (the setup script checks). Set it on the quotes box too if quote autopilot is on: autopilot sends create the Checkout session / invoice there. |
| `STRIPE_TAX_CODE` | ✓ | ✓ | — | **TODO [TAX CODE — owner picks]:** `txcd_…` product tax code put on every line. `npm run stripe:setup` prints the candidates (landscaping / lawn / garden / snow); pick one with your accountant. Unset = omitted, so Stripe uses the account's default tax code. Never guess one. |
| `EMAIL_PROVIDER` | ✓ | ✓ | — | `log` (default, prints instead of sending) · `resend` · `postmark` · `smtp` (TODO). **[EMAIL PROVIDER — ask owner]** |
| `EMAIL_FROM` | ✓ | ✓ | with provider | Sending address, e.g. `Emmett's Property Services <hello@…>`. **[sending domain — ask owner]** |
| `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` | ✓ | ✓ | with provider | Provider credential. |
| `SMS_PROVIDER` | ✓ | ✓ | — | `log` only in v1. **[SMS provider — ask owner]** Texts go only to `sms_opt_in` customers. |
| `GEOCODER` | ✓ | ✓ | — | `none` (default) · `nominatim` · `google` · `mapbox`. **[GEOCODER — ask owner]** |
| `GEOCODER_API_KEY` | ✓ | ✓ | google/mapbox | Geocoder credential. |
| `GEOCODER_USER_AGENT` | — | ✓ | — | Nominatim requires a contact string. |
| `PARCEL_SOURCE` | — | ✓ | — | `none` (default). `cuyahoga_gis` / `regrid` are stubs. **[PARCEL DATA SOURCE — ask owner]** |
| `NWS_USER_AGENT` | — | ✓ | — | api.weather.gov requires an identifying User-Agent with a contact email. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ✓ | — | — | Cloudflare Turnstile on the quote form (widget renders only when set). |
| `TURNSTILE_SECRET_KEY` | ✓ | — | with site key | Server-side Turnstile verification. Honeypot + rate limit are always on. |
| `BUSINESS_NAME` | ✓ | ✓ | — | Email header/footer name. Defaults to Emmett's Property Services. |
| `REVIEW_URL` | — | ✓ | — | Google review link used in review-request drafts (TODO until the owner supplies it). |
| `FLEET_ROLE` | — | ✓ | ✓ | `ads` · `quotes` · `scheduler` · `followup` · `host`. One per box. |
| `FLEET_NAME` | — | ✓ | — | Worker display name on the Fleet panel. Defaults to `<role>-<hostname>`. |
| `FLEET_ROOT` | — | ✓ | — | Install directory (default `/opt/fleet`), used for the version stamp. |

## Business settings that are not env vars

Edited at `/admin/autopilot` → Business settings (the single `settings` row). Unknowns from the plan are left
null and badged **TODO** in the UI until the owner fills them in:

| Setting | Default | Note |
| --- | --- | --- |
| `min_job_price` | null | **[MIN PRICE — ask owner]** |
| `drop_notice_hours` | 24 | Plan default. |
| `ai_monthly_cap` | null (no cap) | **[CAP $ — ask owner]**. When hit, drafting stops and an `ai_cap` card appears in the inbox. |
| `partner_tree_service_name/email` | null | **[PARTNER — ask owner]** for referrals. |
| `default_wage` / `margin` / card fees | 15 / 0.50 / 2.9 % + $0.30 | From the plan. |
| `autopilot` | all off | Per approval kind. |
| `invoice_days_until_due` | 7 | Default net terms for **Send as invoice** on a quote (the owner can change it per invoice). |

## Local development

```bash
cp .env.example .env.local           # fill in Supabase + Anthropic (+ Stripe test keys)
npm run dev                          # http://localhost:3000
npm run test                         # unit tests (vitest)
npm run test:db                      # migrations + RLS against local Postgres (see supabase/README.md)
stripe listen --forward-to localhost:3000/api/stripe/webhook   # copy the whsec into STRIPE_WEBHOOK_SECRET
STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --site https://www.eodlawns.com   # production webhook + Stripe Tax check
FLEET_ROLE=host npm run fleet        # run one worker locally
```
