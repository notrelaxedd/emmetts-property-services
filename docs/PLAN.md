# EOD Lawns Ops — Claude Code Build Plan (v2)

Paste this whole file into Claude Code from the root of the **eodbuilds** repo, or save it as `docs/PLAN.md` and tell Claude Code: "Follow docs/PLAN.md phase by phase."

---

## Instructions for Claude Code

You are adding an operations system to an existing site. Work **phase by phase**. Commit at the end of each phase with a clear message. Stop and ask me before:
- deleting or renaming any existing route, component, or table
- adding a paid service or a heavy dependency
- anything that sends real email/SMS or charges real money (use Stripe **test mode** until I say go)

If you use subagents, set their model to **Sonnet**. Never use Haiku.

Values in `[BRACKETS]` are unknowns. Leave them as clearly marked config or TODOs; don't invent them.

**Stack (match what the repo already uses; adjust if Phase 0 finds otherwise):** Next.js 14 App Router, Supabase (Postgres, Auth, Storage), Tailwind + shadcn/ui, Vercel. **All AI tasks use the Anthropic API** (Claude) through the official `@anthropic-ai/sdk`. Don't add Gemini, OpenAI, or any other AI provider.

---

## What we're building (one paragraph)

Ads bring homeowners to a quote form. Fleet workers (4 Debian boxes + 1 host) draft ads, scan properties and price quotes, schedule jobs, and send follow-ups. Every outbound action lands in an **owner approval inbox** at `/admin` where I approve, edit, or reject it. Customers prepay through Stripe. A mobile **crew app** at `/crew` lets crew set flexible availability, accept or drop jobs, and request time off. Custom requests (e.g. tree removal) are never auto-quoted; I price them, refer them to a partner, or decline.

Design reference: the "EOD Lawns Admin" canvas (inbox, quote review, schedule, crew weekly hours, crew time off & changes, workflow). Match its layout, but use the repo's existing styling and shadcn components.

---

## Phase 0 — Audit the repo (no code changes)

1. Map the repo: framework version, routing, existing pages (esp. any booking/contact form), styling, auth, Supabase usage, env vars, deploy config.
2. Write findings to `docs/AUDIT.md`: what exists, what we can reuse, conflicts with this plan, and proposed route names.
3. **Stop and show me AUDIT.md** before Phase 1.

---

## Architecture

```
app/
  (public)/…            existing marketing site — don't break it
  (public)/quote        new quote form (or upgrade the existing form)
  admin/…               owner console (role = owner)
  crew/…                crew app, mobile-first PWA (role = crew)
  api/stripe/webhook    Stripe webhook
lib/
  pricing.ts            pure pricing function + tests
  scheduler/            pure scheduling module + tests
  ai/claude.ts          the ONLY place that calls the Anthropic API
supabase/migrations/    all schema changes as migrations
fleet/                  Node 20 + TypeScript worker for the Debian boxes
  worker.ts             one binary, role chosen by env (ads|quotes|scheduler|followup|host)
  systemd/              unit files
```

Fleet workers talk **only to Supabase** (task queue + tables) using a service-role key stored on the workers, never in the browser. The public site and the database stay on Vercel + Supabase, so the business keeps running if a fleet box dies.

---

## AI setup (Anthropic API) — do this in Phase 1

- Env vars: `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`; don't use Haiku models). Set them in Vercel and in each fleet box's `.env`. **Server-side only**: never in client code, never prefixed `NEXT_PUBLIC_`, never committed.
- `lib/ai/claude.ts` exports small typed helpers, each with its own system prompt and a JSON output schema validated with zod:
  - `draftAd(channel, season, offer)` → headline, body, CTA
  - `draftMessage(kind, customer, job)` → subject, body (review, reminder, snow plan, referral, decline)
  - `summarizeCustomRequest(note, photoUrls)` → plain-English summary, likely crew size + hours range, and a **suggested** price range for me (never sent to the customer automatically). Uses Claude's image input for the photos.
  - `estimateFromPhotos(photoUrls, lotAcres)` (optional) → tree-cover level for the hours estimate
- Guardrails: log every call to an `ai_usage` table (`task`, `model`, `input_tokens`, `output_tokens`, `est_cost`, `created_at`); enforce a monthly spend cap from `settings.ai_monthly_cap` [CAP $]. When the cap is hit, stop drafting and raise an approval card instead of failing silently. Use prompt caching for the long, repeated system prompts. Retry on 429/529 with backoff.
- Every AI output is a **draft** that goes to the approval inbox. Nothing AI-written reaches a customer without passing through `approvals` (or an autopilot rule I turned on).
- Show this month's AI spend on the Money page and the Fleet panel.

---

## Phase 1 — Database, roles, and security

Create migrations for these tables (add `id uuid pk`, `created_at`, `updated_at` everywhere):

| Table | Key columns |
|---|---|
| `profiles` | `user_id → auth.users`, `role` (owner/crew), `name`, `phone`, `max_hours_week`, `paused bool`, `hourly_rate` (default from settings) |
| `services` | `name`, `active`, `auto_quote bool`, `default_crew_size`, `minutes_rule jsonb` (base + per-acre + tree-cover modifiers), `seasonal` |
| `customers` | `name`, `email`, `phone`, `address`, `lat`, `lng`, `parcel_id`, `lot_acres`, `email_opt_in`, `sms_opt_in`, `snow_list bool`, `notes` |
| `leads` | `customer_id`, `source`, `utm` jsonb, `requested_service_ids uuid[]`, `custom_request text`, `photo_paths text[]`, `status` |
| `quotes` | `lead_id`, `status` (draft/needs_owner/sent/accepted/expired/declined), `price_total`, `labor_total`, `margin`, `stripe_checkout_id`, `sent_at`, `accepted_at` |
| `quote_items` | `quote_id`, `service_id` (null = custom), `description`, `is_custom`, `crew_size`, `est_hours`, `price`, `status` (auto/needs_owner/priced/referred/declined), `partner_note` |
| `jobs` | `quote_id`, `customer_id`, `status` (unscheduled/proposed/crew_confirmed/booked/in_progress/done/cancelled), `start_at`, `end_at`, `est_minutes`, `crew_size`, `paid bool`, `weather_hold bool` |
| `job_assignments` | `job_id`, `crew_id`, `status` (offered/accepted/declined/swap_offered/drop_requested/dropped), `responded_at` |
| `owner_windows` | `weekday`, `start_time`, `end_time` (many rows per day allowed) |
| `owner_exceptions` | `date`, `closed bool`, `start_time`, `end_time` |
| `crew_availability` | `crew_id`, `weekday`, `start_time`, `end_time` (**many blocks per day**) |
| `crew_exceptions` | `crew_id`, `date_from`, `date_to`, `start_time?`, `end_time?`, `kind` (off/extra), `status` (pending/approved/declined), `note` |
| `approvals` | `kind` (ad/quote/custom_item/booking/followup/crew_change/drop), `ref_table`, `ref_id`, `payload jsonb`, `status` (pending/approved/edited/rejected), `created_by` (worker name or user) |
| `ads` | `channel` (facebook/instagram/nextdoor), `headline`, `body`, `image_path`, `targeting` jsonb, `utm_code`, `status` (draft/approved/posted) |
| `messages` | `customer_id`, `channel`, `kind` (review/snow/reminder/quote), `subject`, `body`, `status`, `sent_at` |
| `payouts` | `crew_id`, `job_id`, `hours`, `rate`, `amount`, `paid_cash_at` |
| `expenses` | `date`, `category`, `amount`, `note` |
| `ai_usage` | `task`, `model`, `input_tokens`, `output_tokens`, `est_cost` |
| `settings` | single row: `ai_monthly_cap` [CAP $], `default_wage` 15, `margin` 0.50, `min_job_price` [MIN PRICE], `card_fee_pct` 0.029, `card_fee_fixed` 0.30, `drop_notice_hours` [24], `autopilot jsonb` (per approval kind, all **off** by default) |
| `fleet_workers` | `name`, `role`, `last_heartbeat`, `cpu`, `ram`, `temp_c`, `current_task` |
| `fleet_tasks` | `type`, `payload jsonb`, `status` (queued/running/done/failed), `worker`, `attempts`, `run_after`, `result jsonb` |

Also:
- Postgres function `claim_task(role text)` using `FOR UPDATE SKIP LOCKED`.
- **RLS:** owner = full access. Crew = read their own assignments and the job time/address/service/notes (**no prices or customer phone/email**); write only their own `crew_availability`, `crew_exceptions`, and assignment responses. Anonymous = no table access; the quote form inserts through a server action.
- Seed `services`: leaf cleanup, edging, gutter cleaning, mowing, snow removal (`auto_quote = true`). Seed `settings`.
- Storage bucket `lead-photos` (private; signed URLs in admin).

**Done when:** migrations apply cleanly, RLS tests pass (crew can't read prices, anon can't read anything).

---

## Phase 2 — Public quote form

- Fields: name, email, phone, address (autocomplete [GEOCODER — ask me]), service checkboxes from `services`, **"Something else?" textarea + up to 4 photos**, preferred days, consent checkboxes (email updates, texts, snow list).
- Server action: upsert customer → create lead → enqueue `fleet_tasks{type:'quote'}`.
- Spam protection (Cloudflare Turnstile or honeypot + rate limit).
- Confirmation page: "Your quote is on the way."

**Done when:** a test submission creates customer + lead + task, photos land in storage.

---

## Phase 3 — Pricing engine (`lib/pricing.ts`, pure + unit tested)

```
labor  = crew_size × hours × wage
price  = max(min_job_price, round(labor / (1 − margin)))
fee    = price × card_fee_pct + card_fee_fixed
profit = price − labor − fee
```
- Hours estimate from `services.minutes_rule` + `lot_acres` + tree cover; owner can override any number.
- Custom items: **no price**, status `needs_owner`.
- Tests: the $15/hr, 2 crew, 1.5 h, 50% margin case → labor $45, price $90.

---

## Phase 4 — Owner console (`/admin`)

Sidebar: Approval inbox (home, with pending count), Ads, Leads, Quotes, Schedule, Availability, Employees, Customer log, Money, Autopilot rules, plus a Fleet status panel.

- **Approval inbox:** one feed from `approvals`, filter chips (All/Ads/Quotes/Custom/Appointments/Follow-ups/Crew changes). Every card: **Approve / Edit / Reject**. Edit opens the underlying record inline.
- **Custom request card:** customer note, photos, the auto-quoted standard part, inputs for **your price, hours on site, crew needed**, buttons **Add my price to quote / Refer to partner / Decline**. Refer and decline email the customer (after approval).
- **Quotes:** property panel (map/parcel placeholder until data source is set), line items, steppers for crew/hours/wage/margin with live labor/fee/profit/price, **Send via Stripe**.
- **Schedule:** week view, owner windows, jobs colored by status, drag to move (re-check crew availability on drop), weather holds.
- **Availability:** edit owner windows + exceptions; view every crew member's blocks and pending time-off requests (approve/decline).
- **Employees:** invite crew (magic link), rate, max hours, hours this week, cash payout log ("mark paid").
- **Customer log:** history, jobs, messages, opt-ins, snow list.
- **Money:** Stripe revenue (from webhook), payouts, expenses → profit per job / week / month.
- **Autopilot rules:** per-kind toggles + thresholds (e.g. auto-send quotes under $[X]). All off by default.
- **Fleet:** each worker's heartbeat, CPU/RAM/temp, current task, last error.

---

## Phase 5 — Stripe

- On quote approval: create a Checkout Session with one line per priced item; email the link to the customer.
- Webhook `checkout.session.completed` → quote `accepted`, create `job` (`unscheduled`, `paid = true`), enqueue `schedule` task.
- Refund path for cancellations (owner button).
- Test mode only until I approve going live.

---

## Phase 6 — Scheduler (`lib/scheduler/`, pure + unit tested)

**Inputs:** owner windows minus owner exceptions; each crew member's weekly blocks minus approved time off, plus approved extra days; existing assignments; `max_hours_week`; `paused`; job duration + crew size; customer preferred days; weather holds.

**Algorithm v1 (greedy, explainable):**
1. Order unscheduled jobs by paid date, then deadline.
2. For each job, find the earliest slot inside an owner window where ≥ `crew_size` crew are free for the whole duration and under their max hours.
3. Prefer slots next to jobs nearby (lat/lng distance) to cut drive time; spread hours fairly across crew.
4. Output: job → `proposed`, assignments → `offered`. Save a short "why" string for the inbox card.

**Re-runs:** when crew change availability, drop/swap a job, a time-off request is approved, or a weather hold hits, re-solve the affected jobs. If no cover is found, raise an approval for me.

**Confirm flow:** all assigned crew accept → `crew_confirmed` → booking approval to me (unless autopilot) → `booked` → customer gets a confirmation + day-before reminder.

Tests: overlapping blocks, split days, max-hours cap, paused crew, time off, extra day, drop inside notice window.

---

## Phase 7 — Crew app (`/crew`, mobile-first, installable PWA)

Crew should be able to change their schedule as freely as possible:

- **Weekly hours:** toggle each day; **multiple time blocks per day** (add/remove); max hours a week; **pause all new jobs** toggle. Saves automatically. Changes only affect jobs that aren't booked yet.
- **Time off & extra days:** date ranges or partial days off; one-off extra availability. Time off that hits a booked job, or is inside `drop_notice_hours`, goes to me for approval; otherwise auto-approved.
- **Job offers:** Accept / Can't make it (declines trigger a re-solve for a replacement).
- **Booked jobs:** **Offer swap** (offered to eligible crew; first to accept takes it) or **Drop** (outside the notice window = scheduler finds cover; inside it = needs my OK).
- **On the job:** Start / Complete buttons, actual hours, optional photos.
- **Pay:** hours and cash owed per job/week.
- Login: Supabase magic link or phone OTP; owner-invite only.

---

## Phase 8 — Fleet workers (`fleet/`)

One TypeScript worker; role from `FLEET_ROLE` env. Each loop: heartbeat (CPU/RAM/temp) every 30 s → `claim_task(role)` → run → write result. Retries with backoff; failures surface on the Fleet panel. Ship systemd unit files + a `fleet/README.md` with setup for headless Debian (some boxes boot from 16 GB flash drives, so keep disk writes and logs small: log to journald, no local DB).

| Role | Box | Does |
|---|---|---|
| `ads` | W1 | Weekly + seasonal ad drafts per channel via `lib/ai/claude.ts` → `ads` + approval. **v1 does not auto-post**: approved ads show copy + an "Open Ads Manager / Nextdoor" button. Auto-posting is v2 (needs Meta app review). |
| `quotes` | W2 | Geocode → parcel lookup [PARCEL DATA SOURCE — ask me] → estimate hours → price standard items → quote + approval; custom items flagged `needs_owner` with a Claude summary + suggested range shown on the card. |
| `scheduler` | W3 | Runs `lib/scheduler` on events + every 15 min. |
| `followup` | W4 | Review request 24 h after `done`; day-before reminders; **weather watch** via the free NWS API (api.weather.gov) for the service area → snow forecast drafts a snow-plan email to opted-in customers → approval; rain → proposes weather holds. |
| `host` | Host | Enqueues scheduled tasks (cron), watches heartbeats, marks stale tasks for retry. |

Rules for every worker: anything customer-facing goes through `approvals` unless that kind's autopilot is on. Emails include an unsubscribe link. Texts only to `sms_opt_in` customers. Email provider: [EMAIL PROVIDER — ask me].

---

## Phase 9 — Testing and launch

- Unit tests: pricing, scheduler, RLS.
- One end-to-end test (Playwright): form → auto quote → owner approves → Stripe test payment → scheduled → crew accepts → owner approves → complete → review request drafted.
- Verify the existing public site still works unchanged.
- `docs/ENV.md`: every env var and where it lives (Vercel vs fleet boxes).
- Deploy a Vercel preview; send me the link and a checklist of what to try.

---

## Open questions for me (ask before the phase that needs them)

1. Email provider and sending domain
2. Address autocomplete / geocoder
3. Parcel/lot-size data source for Rocky River
4. Minimum job price and drop-notice window (default 24 h)
5. Partner tree service for referrals (name/email)
6. Whether crew log in by email or phone
7. Monthly AI spend cap
