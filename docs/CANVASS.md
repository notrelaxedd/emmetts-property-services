# Canvass: door-to-door planning

The **Canvass** tab (`/admin/canvass`) tells the crew which houses to knock, a time **range** to knock them, and
what to quote at the door. It is built for a three-person crew selling mowing, leaf cleanup and snow removal on
foot in Rocky River: pull a street's parcels from the county, see a window and a price range per house, plan a
walking route for a slot, log every knock from a phone in under three seconds, hang QR door hangers per street and
read what worked the next morning.

```
draw an area ──▶ pull county parcels ──▶ block-group ACS prior ──▶ window + quote + score per house
                                                                          │
   nightly summary ◀── knock log + QR scans ◀── crew logs at the door ◀── plan my session (route for a slot)
```

| Route | Who | What |
| --- | --- | --- |
| `/admin/canvass` | owner | Nightly summary card, area picker map, parcel table, stat cards |
| `/admin/canvass/parcels/[id]` | owner | Parcel detail: quote (estimate + traced), lawn tracing, window + reason, knock history, homeowner / crew edits |
| `/admin/canvass/plan` | owner | Plan my session |
| `/admin/canvass/hangers` | owner | Hanger code per street, conversions, link to the print sheet |
| `/admin/canvass/hangers/[code]/print` | owner | Letter 3-up hanger sheet with QR |
| `/admin/canvass/stats` | owner | Knocker + pitch stats, hanger conversions, pitch management |
| `/admin/canvass/settings` | owner | Pricing, thresholds, doors/hour, neighbor N, recency, season map, value tier, county field map, land-use codes |
| `/crew/knock` | crew + owner | The knock logger (mobile-first; "Knock" in the crew tab bar) |
| `/h/[code]` | public | Hanger QR landing: logs the scan, sets the `hanger` cookie, redirects to the quote form |
| `/api/cron/canvass-summary` | Vercel cron | Nightly summary (10:00 UTC: 06:00 EDT / 05:00 EST), `Authorization: Bearer CRON_SECRET` |

## Data sources and the privacy rules

Everything the tab knows comes from exactly five places. Nothing else is allowed, by rule and by test.

| # | Source | Host | What we take |
| --- | --- | --- | --- |
| 1 | Cuyahoga County public parcel layer (ArcGIS REST, `Open_Data_Parcels/MapServer/1`, non-Cleveland) | `gis.cuyahogacounty.gov` | Parcel PIN, site + mailing address, land-use code, acreage, market value, year built, living sqft, stories / footprint when present, homestead (owner-occupancy) flag when present, the polygon |
| 2 | Census ACS 5-year estimates at the **block-group** level, plus block-group polygons | `api.census.gov`, `tigerweb.geo.census.gov`, `geocoding.geo.census.gov` (fallback) | Aggregates only: departure-time and commute-time distributions, % not in labor force, % 65+, share of families with a non-working parent, median household income (display only) |
| 3 | What the crew observed / the homeowner said | — | `callback_window` ("weekdays after 5"), `home_pattern` tag, `do_not_knock`, notes |
| 4 | Our own knock log and QR scans | — | Outcome, knocker, pitch, GPS, weather at the knock; hanger scans and bookings per street |
| 5 | Open-Meteo (free, no key) | `api.open-meteo.com` | Temperature, precipitation, conditions stored with every knock |

Map tiles (browser only) come from `server.arcgisonline.com` (Esri World Imagery, overridable with
`NEXT_PUBLIC_SATELLITE_TILE_URL`) and `tile.openstreetmap.org`. The nightly summary is the only AI call and goes
through `lib/ai/claude.ts` to `api.anthropic.com` (Sonnet, never Haiku).

The hard rules:

- **No people-search, data broker, social network, LinkedIn or employer site. Ever.** Not for the owner's name, not
  for "is anyone home". `lib/canvass/privacy.ts` holds the allowlist (`ALLOWED_HOSTS`, the hosts above plus
  `localhost` / `example.*` for tests, and `ALLOWED_LINK_HOSTS` for href-only attribution links) and a denylist
  (`linkedin`, `spokeo`, `whitepages`, `beenverified`, `truepeoplesearch`, `facebook.com`, `zillow`,
  `peoplefinder`, `intelius`). `lib/canvass/privacy.test.ts` walks `lib/canvass`, `app/admin/canvass`,
  `app/crew/knock`, `app/h`, `app/api/cron`, `components/admin/canvass` and `components/crew/knock`, extracts every
  `https?://host` and fails, naming the file and the host or term, for anything outside the allowlist. That test is
  the "no people-search code path" acceptance check; it runs with `npx vitest run`.
- **Never infer an individual's employer, work hours, income or retirement** from outside sources. The Census
  numbers describe a block group (roughly 600–3,000 people), are stored per block group, and are only ever shown as
  "Area: ~40% of households…". Median income is displayed, never used in a score.
- **The owner's name is for display and greeting only** (`parcels.owner_display`). It is never sent anywhere and
  never used to look anything up. An LLC / trust / corporate owner only flips `owner_is_entity` so the crew uses the
  landlord pitch.
- **`do_not_knock` is forever.** "No Soliciting sign" or "Asked not to return" at the door sets it (with a
  reason); so can the owner on the parcel page. A re-pull from the county keeps it, and such a parcel never appears
  in a route or plan (`planSession` excludes it, and the logger shows it as do-not-knock).
- **Every timing output is a range**: a 2-hour bucket ("Weekdays 4–6pm likely") or "Anytime weekdays". There is no
  minute-level prediction anywhere in the code.
- **Throttle and cache.** County pages are fetched sequentially with a 15 s timeout; ACS is one call per table for
  the whole county; TIGERweb / the geocoder run two at a time. Everything lands in Supabase (`parcels`,
  `block_groups`) and is reused.

## Why ACS table B23007 (and not B11003)

The owner brief offered B11003 or B23007 for "share of family households with a parent not in the labor force" and
asked us to pick the cleaner one. We use **B23007**.

- **B11003** ("Family type by presence and age of own children under 18") only says what kind of family lives
  there, married-couple or single-parent, not whether anyone works.
- **B23007** ("Presence of own children under 18 by family type by employment status of parents") counts families
  with own children under 18 and, for married couples, whether *both*, *only the father*, *only the mother* or
  *neither* parent is in the labor force; for single-parent families, whether the householder is in the labor force.

So "at least one parent not in the labor force" is a direct sum of B23007 cells:

```
numerator   = married: father only + mother only + neither parent in labor force
            + other:   male householder not in labor force + female householder not in labor force
denominator = "With own children of the householder under 18 years"
pct_hh_nonworking_parent = numerator / denominator
```

That is exactly the "someone is likely home on a weekday" signal the window logic wants. Variable ids are never
guessed: `lib/canvass/census.ts` fetches each table's group metadata (`/groups/<table>.json`) and picks the
estimate variables by their documented label, so a vintage bump does not silently read the wrong column.

The other tables: **B08302** (time leaving home for work) and **B08303** (travel time to work) give the departure
and commute distributions (stored as `{ "<bucket label>": count }`), **B23025** gives `% not in labor force`,
**B01001** gives `% 65+`, **B19013** median household income (display only). Census null sentinels (negative
values such as `-666666666`) become `null`.

## Window logic (ranges, not times)

`lib/canvass/windows.ts` → `resolveWindow()` picks one window per house in this order; the source and a hover
reason are stored with it:

1. **Homeowner-stated `callback_window`** ("weekdays after 5" → weekdays 5–9pm; "any time Sat" → weekends
   anytime; "mornings" → 8–12). Overrides everything. Text we cannot parse still wins, shown as
   "Homeowner: <text>".
2. **Crew `home_pattern` tag**: `home_weekdays` → weekdays 9–5 "Home weekdays (crew)", `evenings_only` → weekdays
   5–8pm, `weekends_only` → weekends 10–4; `unknown` falls through.
3. **Learned layer** (once the block group or street has `learned_min_knocks` knocks, default 8): a Beta-Binomial
   P(answer) per weekday-vs-weekend × 2-hour bucket. The ACS prior's bucket starts at α=4, β=2, every other bucket
   at α=1, β=3, so early data is shrunk toward the prior; posterior mean = (α + answers) / (α + β + knocks). An
   "answer" is any outcome but `no_answer`. It picks the best bucket (ties go to the prior) and refines ranges; it
   never outputs an exact time. The pool is the whole recent knock log (the same 5000 knocks the conversion model
   fits on) plus older knocks on the houses in view, so the table, the parcel page, the knock logger and the digest
   agree on a house's window.
4. **ACS block-group prior** (`acsPrior`, works on day one):
   - **Daytime-friendly** when `pct_not_in_lf ≥ daytime_not_in_lf_threshold` (default 0.40) **or**
     `pct_hh_nonworking_parent ≥ daytime_nonworking_parent_threshold` (default 0.35) → weekdays 10am–4pm,
     "Anytime weekdays (daytime OK)", reason "Area: ~40% of households have a non-working adult → daytime OK."
   - Otherwise a **return-home window**: typical departure (weighted median of B08302) + commute (weighted median
     of B08303) + `work_hours` (default 8.5) + commute back, snapped to an even 2-hour bucket between 3pm and 9pm,
     reason "Area: typical departure ~7:30am + ~25 min commute + 8.5h → home ~4:30pm".
5. **Default** when there is no area data: weekdays 5–7pm, reason "No area data yet".

`windowOverlapsSlot(window, slot)` is what "Plan my session" uses to keep only houses whose window overlaps the
chosen slot.

## Quoting

`lib/canvass/quote.ts`, all driven by the `canvass_settings` row so the quote updates live when settings change:

- **County estimate**: `turf_sqft_est = max(0, lot − footprint − lot × hardscape_pct)` with footprint = the
  county's footprint field, else living sqft ÷ stories (1 when unknown); `hardscape_pct` defaults to 0.12. Null
  when the lot size is unknown.
- **Map-trace**: on the parcel page the crew draws the real lawn polygon(s) on the satellite view; the area comes
  from `@turf/area` (m² × 10.7639) and is saved as `turf_sqft_traced` + `turf_geom`. **Traced always overrides the
  estimate** (`effectiveTurf`).
- **Range**: `price = base_prices[service] + rate_per_1000_sqft × turf / 1000`, floored at `min_charge`;
  `low = round5(0.9 × price)`, `high = round5(1.15 × price)`, shown as "$75–$95". The `basis` string explains the
  arithmetic on hover.
- **Value tier** (default **off**): when enabled, ×`value_tier_max` for houses valued ≥ $400k, half of that bump
  at ≥ $250k, nothing below. The code caps the multiplier at **1.10** whatever the settings row says.

Defaults: mow $35, edge $15, leaf cleanup $150, gutters $120, snow $45 per visit; $6.00 per 1,000 sqft; $40
minimum.

## Priority score

`lib/canvass/score.ts`:

```
score = P(answer in the chosen slot) × P(convert) × expected job value × neighbor_boost
```

- **P(answer)**: the learned bucket for the slot when there is one, else the prior.
- **P(convert)**: starts flat at 0.08 and learns from our own knock log (a "convert" is `booked` or
  `quote_given`) over lot-size band (< 6k / 6–12k / > 12k sqft), owner-occupied, near-customer, street, knocker and
  pitch. Each feature value gets Laplace smoothing (k = 5 knocks at the base rate), the factors combine naive-Bayes
  style (prior odds × Π feature rate / base rate) and the result is clamped to 0.01–0.6.
- **Expected job value**: the quote mid for the season's service.
- **neighbor_boost**: 1.5 when an existing customer is within `neighbor_n` houses (default 3) on the same street or
  within 60 m; 1.2 within 150 m; else 1.0. Customers come from the existing `customers` table.

The breakdown is shown on hover; parcels on the map are coloured by score quintile.

## Plan my session

Pick a date and a slot (default next weekday 3–5pm) and a start point. `planSession` drops `do_not_knock`
houses, houses knocked in the last `recency_days` (default 14) and houses whose window does not overlap the slot,
sorts by score, takes `doors_per_hour × hours` (default 25/hour), and orders them nearest-neighbour + 2-opt from the
start point. "Save plan" writes `canvass_plans`; the logger shows the next stops.

## The field map: first-run procedure

The county GIS host could not be reached while this was built, so **field names are discovered at runtime, never
hard-coded as truth**. `lib/canvass/county.ts` fetches `/MapServer/1?f=pjson`, matches each key (`parcel_id`,
`owner`, `site_address`, `mailing_address`, `land_use`, `acreage`, `shape_area`, `market_value`, `year_built`,
`living_sqft`, `stories`, `footprint_sqft`, `owner_occupied`, `street`) against candidate names and aliases, stores the
result in `canvass_settings.parcel_field_map` (with every layer field as a candidate), logs it, and shows it on the
Settings page where the owner can override each mapping. `street` is optional: when the layer has no street-name
field it is derived from the site address (house number and unit stripped, upper-cased).

First run:

1. Open **Canvass → Settings** and press **Refresh from county**. The server logs the layer's real field names and
   fills the field map.
2. Check each row of the field-map table. Anything shown as *missing* or mapped to an odd column: pick the right
   layer field from the dropdown and save.
3. Draw a small polygon over a Rocky River street on the map and press **Pull parcels**.
4. **Spot-check three addresses against MyPlace** (the county's public property lookup): address, lot size and
   market value must match. If they do not, fix the mapping and pull again.
5. Confirm the land-use filter: the residential prefixes (default `510`–`519`) should keep single-family homes and
   drop the commercial / multi-family parcels on the edge of the area.

If the Vercel deployment cannot reach the county server, run the manual GitHub Actions workflow
"County parcel layer probe" (`.github/workflows/county-probe.yml`): it prints the layer's real field
names and a few Rocky River sample rows from GitHub's network, which can be compared with the Settings page.

Owner-occupied comes from the homestead / owner-occupancy field when the layer has one, else from "mailing address
equals site address", else unknown.

## Door hangers and QR codes

One code per street (`hanger_codes`, same unambiguous alphabet as the flyer codes). The QR encodes
`<site>/h/<code>`; the landing route logs a scan (`hanger_events`, visitor = truncated sha256 of ip + user agent,
bots and repeat scans filtered), sets the `hanger` cookie for 60 days and redirects to
`/quote?src=hanger&s=<code>&utm_source=hanger&utm_medium=qr&utm_campaign=<code>`. When a quote is submitted,
`attributedHangerCode` credits the `src`/`s` or utm tags first, then the cookie, and a `booking` event is written.
**Hanger conversions by street** (unique scans, bookings, rate) show on the Hangers and Stats pages.

The print sheet is Letter, 3-up, with the QR, the code, a short pitch, the phone number and the season offer
(`canvass_settings.offer_text`, or the default copy from `lib/canvass/season.ts`).

## Season-aware pitch

`canvass_settings.season_map` maps month → featured service. Default: **Sep–Nov leaf cleanup, Dec–Mar snow removal
(+ spring mowing pre-sale), Apr–Aug mowing & edging**. `seasonFocus(month)` gives the service, a label, a one-line
door pitch and the default hanger offer; the logger header and the hanger sheet both use it.

## Knocker and pitch stats

`knockStats` on the Stats page: per knocker and per pitch, knocks (the sample size), answers (any outcome but
`no_answer`), answer rate, quotes given, closes (`booked`) and close rate (closes ÷ answers). Pitches are managed on
the same page; the crew picks one at session start.

## Nightly summary

`/api/cron/canvass-summary` runs at 10:00 UTC (vercel.json `0 10 * * *`; Vercel cron is UTC, so 06:00 EDT in summer and 05:00 EST in winter), requires `Authorization: Bearer
CRON_SECRET`, and summarises yesterday's knocks (by street, knocker and pitch), the best and worst streets and
tomorrow's suggested streets + windows through `lib/ai/claude.ts` (Sonnet, structured output, low effort, within the
AI spend cap). Days with no knocks store a minimal summary without calling the model. The card sits at the top of
the tab with a "Run now" button for testing.

How it runs (`lib/canvass/summary.ts`):

- `buildCanvassDigest(db, date)` collects the day's knocks in America/New_York (`dayBounds`), joins streets, knocker
  and pitch names, counts QR scans that day and the planner's area window label per street (learned / ACS / default
  only; a homeowner's or crew tag's per-house label is never counted), and `digestFromRows` turns
  them into an **aggregate-only** digest: counts by outcome, street, knocker, pitch and 2-hour bucket, the weather at
  the knocks. No notes, no callback text, no owner names ever reach the model.
- `runNightlySummary(db, date = yesterday)` stores `{ headline: "No knocks on <date>", ... }` when the day had no
  knocks, otherwise calls `summarizeCanvassDay` (task `canvass_summary`, effort `low`, cap-checked by `runStructured`)
  and upserts `canvass_summaries` on `for_date` (a re-run replaces the row; `model` records which model wrote it).
- The route answers `401 { ok: false, error: "unauthorized" }` without the exact bearer token (also when
  `CRON_SECRET` is unset), `503` when the service-role client is not configured, `500` with the error message when
  the digest or the model fails, and `200 { ok: true, for_date, knocks, usedModel, summary }` otherwise. `?date=YYYY-MM-DD`
  re-runs a specific day (handy with `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/canvass-summary?date=2026-10-29`).
- `vercel.json` holds the schedule; Vercel adds the `Authorization` header itself once `CRON_SECRET` is set in the
  project's environment variables.

## QR landing route and booking attribution

`app/h/[code]/route.ts` mirrors the flyer route: it normalises the code, looks up an **active** `hanger_codes` row
(unknown or inactive codes still redirect to `/quote`), sets the `hanger` cookie for 60 days, drops link-preview bots,
rate-limits one client to 10 scan rows per 10 minutes per code, hashes `sha256(ip|user agent)` to 32 hex characters as
the visitor and inserts a `hanger_events` `scan` through `recordHangerScan`. Then it 302s to
`/quote?src=hanger&s=<code>&utm_source=hanger&utm_medium=qr&utm_campaign=<code>`.

`app/actions/quote.ts` calls `recordHangerBooking(db, { utm, cookie, leadId })` (lib/canvass/hanger-events.ts) right
after the lead row is inserted: the QR tags win, else the cookie, and a `booking` event is written for the code (even
if the owner has since deactivated it, since the hanger was still on the door). Both helpers log and swallow every
error, so attribution can never fail a scan or a quote submission.

## Environment variables

| Variable | Required | Purpose |
| --- | :-: | --- |
| `CRON_SECRET` | ✓ | Vercel sends it as `Authorization: Bearer <CRON_SECRET>` to `/api/cron/canvass-summary`; the route returns 401 without it. |
| `CENSUS_API_KEY` | — | api.census.gov key for the ACS pulls. Optional: the API works without one at a lower rate limit. Free from `https://api.census.gov/data/key_signup.html`. |
| `CANVASS_PARCEL_LAYER_URL` | — | Overrides the county parcel layer (default `https://gis.cuyahogacounty.gov/server/rest/services/Open_Data_Parcels/MapServer/1`). Set it if the county moves the service. |
| `NEXT_PUBLIC_SATELLITE_TILE_URL` | — | Satellite tile template for the maps (`{z}/{x}/{y}`). Default: Esri World Imagery. Public by design. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | ✓ / — | Shared with the rest of the app; the summary uses the default `claude-sonnet-5-5`. |

See `docs/ENV.md` for where each one lives.

## Acceptance checklist

- [ ] A polygon drawn over a Rocky River street pulls the right parcels; lot size and market value match MyPlace on
      three spot-checked addresses.
- [ ] Every house shows a window **range** on day one, with a reason on hover.
- [ ] A homeowner-stated callback window overrides everything else for that house.
- [ ] Traced turf overrides the estimate; the quote range updates live when settings change.
- [ ] The value tier is off by default and can never exceed ×1.10.
- [ ] Opening the logger on-site pre-selects the right house (GPS point-in-polygon, nearest centroid fallback); a
      log takes under 3 seconds and works offline (queued, synced on reconnect, idempotent on `client_id`).
- [ ] "Booked" / "Quote given" create the customer, lead and quote; "No Soliciting" / "Asked not to return" set
      `do_not_knock`.
- [ ] A test QR scan plus a booking shows up under the right street in hanger conversions.
- [ ] Do-not-knock houses never appear in a route or plan, even after a re-pull.
- [ ] `lib/canvass/privacy.test.ts` passes: no code path reaches a people-search, broker, social or employer site.
- [ ] Crew can read parcels and settings and insert their own knocks only; anon can read nothing
      (`npm run test:db`).
- [ ] The nightly summary card shows yesterday's digest; "Run now" works and a day without knocks does not call the
      model.
