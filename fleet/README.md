# Fleet workers

One TypeScript worker (`fleet/worker.ts`) runs on each Debian box. `FLEET_ROLE` picks what it does. Workers talk
**only to Supabase**: they claim rows from `fleet_tasks`, write results, and raise cards in the owner's approval
inbox. The site and database live on Vercel + Supabase, so the business keeps running if a box dies; queued work
just waits for a box to come back.

| Box  | Role        | What it does |
| ---- | ----------- | ------------ |
| W1   | `ads`       | Weekly ad drafts per channel (Facebook, Instagram, Nextdoor) via Claude → `ads` + `ad` approval. v1 never posts: approved ads show the copy and an "Open Ads Manager / Nextdoor" button. |
| W2   | `quotes`    | Geocode → parcel lookup → estimate hours → price standard items → quote + `quote` approval. Custom requests get a Claude summary and a `custom_item` approval; never auto-priced. |
| W3   | `scheduler` | Runs `lib/scheduler` on events and every 15 min: proposals, crew offers, cover for declines/drops. |
| W4   | `followup`  | Review requests, day-before reminders, NWS weather watch (snow-plan email, rain holds), message sending. |
| Host | `host`      | The cron: enqueues timed tasks, requeues stale tasks, marks silent workers offline, expires old quotes. Claims nothing. |

Anything customer-facing goes through `approvals` unless the owner turned that kind's autopilot on
(`/admin/autopilot`). Emails get an unsubscribe link from `lib/email`; texts go only to `sms_opt_in` customers.

## Running everything on one machine (laptop or single box)

`FLEET_ROLE=all` runs all five roles in one process, each with its own heartbeat row on the Fleet panel
(`quotes-<hostname>`, `scheduler-<hostname>`, …). Use it for testing from a laptop or when you only have
one box; the 4-box layout below spreads the same roles out.

```bash
FLEET_ROLE=all SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... SITE_URL=https://www.eodlawns.com npm run fleet
```

## How it runs

Every worker loop:

1. **Heartbeat** every 30 s → upserts its `fleet_workers` row (by `name`): CPU % (1-min load ÷ cores), RAM % used,
   SoC temperature from `/sys/class/thermal/thermal_zone0/temp` (null if unreadable), `current_task`, `version`
   (git HEAD of `/opt/fleet`, or `FLEET_VERSION`).
2. **Claim** `claim_task(role, name)` (`FOR UPDATE SKIP LOCKED`, so several boxes can share a role safely).
3. **Dispatch** by `task.type` to `fleet/tasks/<type>.ts`, after validating the payload with zod.
4. **Record**: `complete_task(id, result)`, or `fail_task(id, error, retry_in)` with backoff
   **min(2^attempts, 60) minutes** (2, 4, 8, 16 … capped at an hour) until `max_attempts` (5), then `failed`.
   A bad payload or a missing row fails the task immediately (no retries). The error also lands in the
   worker's `last_error` for the Fleet panel. Tasks time out after 8 min.
5. **Idle**: sleep 5 s when there is nothing to do.

Database outages never crash the loop: the error is logged once (then at most once a minute) and the worker
keeps retrying. `SIGTERM` lets a running task finish (up to 45 s), sends a last heartbeat with
`current_task = null`, and exits 0.

Logs are compact single lines on stdout/stderr, which systemd sends to journald. Nothing is written to disk.

```
INFO start w=W2 task=quote id=1a2b3c4d attempt=1
INFO done w=W2 task=quote id=1a2b3c4d ms=812 quote_id=… status=needs_owner price_total=120 auto_sent=false
ERROR failed, will retry w=W4 task=send_message id=9f8e7d6c err="Resend 503: …" retry_in="4 minutes"
```

## Tasks

| Type | Role | Payload | Enqueued by | Dedupe key |
| ---- | ---- | ------- | ----------- | ---------- |
| `quote` | quotes | `{ lead_id }` | quote form server action; `custom_summary` (re-price after tree cover) | none / `quote:<lead>:tree_cover` |
| `custom_summary` | quotes | `{ lead_id }` | `quote` | `custom_summary:<lead_id>` |
| `schedule` | scheduler | `{ reason, job_ids? }` | `enqueueSchedule` (Stripe webhook, crew changes, weather holds), host + scheduler every 15 min | `schedule:<15-min bucket>` |
| `ad_draft` | ads | `{ channel, season, offer }` | ads worker on startup and from Monday 07:00 ET; admin "draft ad" | `ad_draft:<channel>:<ISO week>` |
| `followup_review` | followup | `{ job_id }` | host, for jobs done 24–72 h ago | `review:<job_id>` |
| `followup_reminder` | followup | `{ job_id }` | host, for booked jobs starting in 20–28 h | `reminder:<job_id>` |
| `weather_watch` | followup | `{ slot? }` | host, every 6 h | `weather:<yyyy-mm-dd>-<0..3>` |
| `send_message` | followup | `{ message_id }` | anything that wants a message delivered off the web request | `send:<message_id>` |

Dedupe keys are unique across **all** statuses (`enqueue_task` returns the existing id), which is why the
recurring ones carry a time bucket.

What each task writes:

- **quote**: fills `customers.lat/lng` (geocoder) and `parcel_id/lot_acres` (parcel source) when missing; one
  `quote_items` row per requested active service (`auto` with a price, or `needs_owner` when the service has
  `auto_quote = false`); one `is_custom` item (`needs_owner`, price null) for a custom note or photos; totals from
  `priceQuote`; `quotes.status` = `needs_owner` if anything is unpriced, else `draft`; `rationale` (the
  `explainPrice` lines). Approvals: `custom_item` per unpriced item, and a `quote` card when something is billable
  (autopilot can send it only when nothing is unpriced). Lead → `quoted`. Re-runs update the same quote and never
  touch items the owner already priced / referred / declined; sent or accepted quotes are left alone.
- **custom_summary**: 10-minute signed URLs for `lead-photos`, Claude summary → `quote_items.ai_summary`
  (owner-only), refreshes the `custom_item` card's summary line; tree cover from photos → `customers.tree_cover`
  when confidence ≥ 0.6 and still unknown. AI cap hit → completes with `{ skipped: "ai_cap" }`.
- **schedule**: `job_ids` that are `proposed` / `crew_confirmed`, or `booked` **with** `weather_hold`, go back to
  `unscheduled` (live assignments → `dropped`; a held job's day is closed for the run). Booked jobs without a hold
  are never moved. Then every `unscheduled` job is solved: proposals → job `proposed` + `start_at/end_at` +
  `schedule_reason`, assignments `offered`. Unplaceable → `booking` approval `{ job_id, unschedulable: true, reason }`.
  Short-handed jobs with a declined/dropped crew member get a `findCover` offer, else a `booking` approval
  `{ job_id, needs_cover: true, missing, declined_crew_ids }`.
- **ad_draft**: `ads` row (`draft`, `utm_code = <channel>-<season>-<yyyymmdd>`, `-2`… if taken) → `ad` approval.
- **followup_review / followup_reminder**: AI draft (plain template if the AI fails or the cap is hit) → `messages`
  draft → `followup` approval `{ message_id, kind, subject, body, job_id }`. Reviews need email opt-in; reminders
  are transactional (email, or SMS only with `sms_opt_in`).
- **weather_watch**: snow in 3 days → one draft reused for every snow-list customer with email opt-in → one
  `followup` approval `{ message_ids, kind: "snow", subject, body, forecast }` (at most one batch per 72 h). Rain ≥ 50 %
  → booked jobs in the rainy periods → one `weather_hold` approval per day `{ job_ids, day, forecast }`.

## Setting up a box (headless Debian 12)

Some boxes boot from 16 GB flash drives, so the setup keeps disk writes small: logs go to a capped journal, there
is no local database, no transpile cache, and the npm cache is cleaned.

```bash
# 1. Node 20 (NodeSource) + git
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x

# 2. Keep the journal small (flash drives)
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=50M\nRuntimeMaxUse=20M\nMaxRetentionSec=14day\n' | \
  sudo tee /etc/systemd/journald.conf.d/fleet.conf
sudo systemctl restart systemd-journald
# Optional on the smallest drives: Storage=volatile keeps logs in RAM only (lost on reboot).
# Also worth it: add `noatime` to the root filesystem's options in /etc/fstab.

# 3. A locked-down user and the code (read-only for the worker)
sudo useradd --system --home-dir /opt/fleet --no-create-home --shell /usr/sbin/nologin fleet
sudo git clone --depth 1 https://github.com/notrelaxedd/emmetts-property-services.git /opt/fleet
cd /opt/fleet
sudo npm ci --omit=dev --no-audit --no-fund
sudo npm cache clean --force

# 4. Secrets (one env file per role on this box)
sudo install -d -m 0750 -o root -g fleet /etc/fleet
sudo install -m 0640 -o root -g fleet /opt/fleet/fleet/env.example /etc/fleet/quotes.env
sudo nano /etc/fleet/quotes.env      # FLEET_ROLE, FLEET_NAME=W2, SUPABASE_*, SITE_URL, ANTHROPIC_API_KEY, ...

# 5. The service
sudo cp /opt/fleet/fleet/systemd/fleet-worker@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fleet-worker@quotes
journalctl -u fleet-worker@quotes -f  # expect "INFO starting ..." and no heartbeat errors
```

**Why `tsx` is a production dependency.** The worker runs straight from TypeScript with `tsx` (no build step, so a
`git pull` + restart is a deploy). `tsx` is therefore in `dependencies`, and the boxes install with
`npm ci --omit=dev`, which skips the test/lint toolchain (Playwright, ESLint, TypeScript, Vitest). The rest of
`dependencies` (Next, React, …) comes along because the repo is one package; it is a few hundred MB and is
never loaded by the worker. Vercel installs dev dependencies anyway, so nothing changes for the site.

### Which role on which box

Give each box one env file named after its role and set `FLEET_NAME` to the box label so the Fleet panel reads
W1–W4 / Host:

| Box  | Env file                     | `FLEET_ROLE` | `FLEET_NAME` | Unit |
| ---- | ---------------------------- | ------------ | ------------ | ---- |
| W1   | `/etc/fleet/ads.env`         | `ads`        | `W1`         | `fleet-worker@ads` |
| W2   | `/etc/fleet/quotes.env`      | `quotes`     | `W2`         | `fleet-worker@quotes` |
| W3   | `/etc/fleet/scheduler.env`   | `scheduler`  | `W3`         | `fleet-worker@scheduler` |
| W4   | `/etc/fleet/followup.env`    | `followup`   | `W4`         | `fleet-worker@followup` |
| Host | `/etc/fleet/host.env`        | `host`       | `host`       | `fleet-worker@host` |

- A box can run two roles: add a second env file and enable a second instance (each needs its own `FLEET_NAME`).
- Two boxes can share a role (e.g. a spare `quotes` box); claiming is safe. Run only **one** `host`.
- If a box dies, enable its role on another box: work waits in the queue; nothing is lost.
- Keys per role: `ANTHROPIC_API_KEY` for ads / quotes / followup; the email provider vars for followup (and for
  quotes if quote autopilot is on, plus `STRIPE_SECRET_KEY`, test mode only); `GEOCODER` / `PARCEL_SOURCE` on
  quotes; `NWS_USER_AGENT` on followup. See `docs/ENV.md`.

### Updating

```bash
cd /opt/fleet && sudo git pull --ff-only && sudo npm ci --omit=dev --no-audit --no-fund && sudo npm cache clean --force
sudo systemctl restart 'fleet-worker@*'
```

The Fleet panel's version column shows the new short commit once the worker restarts.

### Rotating the service-role key

The service-role key bypasses RLS, so treat a leak as urgent.

1. In Supabase: Project Settings → API (API Keys). Create the new secret / service-role key. If your project uses
   the legacy JWT `service_role` key, rotating means rotating the JWT secret, which also changes the anon key:
   plan to update Vercel at the same time.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel and in every `/etc/fleet/*.env` on every box.
3. `sudo systemctl restart 'fleet-worker@*'` on each box; redeploy Vercel.
4. Check the Fleet panel: every worker heartbeats within a minute with no `last_error`.
5. Revoke the old key in Supabase.

### Checking on the fleet

- **`/admin/fleet`**: each worker's last heartbeat, CPU / RAM / temperature, current task, last error and version,
  plus recent tasks with retry buttons and this month's AI spend. The host marks a worker that has been silent for
  3 minutes with `last_error = "no heartbeat"`; the worker clears it on its next heartbeat.
- Stuck work: tasks `running` for more than 10 minutes (box died mid-task) are requeued by the host.
- On a box: `systemctl status fleet-worker@quotes`, `journalctl -u fleet-worker@quotes --since "1 hour ago"`.
- In SQL: `select type, status, attempts, error, run_after from fleet_tasks order by created_at desc limit 20;`

## Development

```bash
npm run fleet:check                    # typecheck fleet/ (tsc -p fleet/tsconfig.json)
npx vitest run fleet                   # unit tests (fake DB, mocked AI / geo / weather / scheduler)
FLEET_ROLE=host SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run fleet
```

`fleet/` is not its own npm package: it uses the root `node_modules`, imports `lib/*` with relative paths (none of
those modules import `next` or `server-only`), and `fleet/tsconfig.json` extends the root config.

Files: `worker.ts` (entry, signals) · `runtime.ts` (loop, claim/complete/fail) · `heartbeat.ts` (metrics, upsert) ·
`tasks/index.ts` (dispatch table) · `tasks/schemas.ts` (payload schemas) · `tasks/*.ts` (one per task type;
`tasks/host.ts` is the host's tick) · `templates.ts` (fallback email copy) · `systemd/` · `env.example`.
