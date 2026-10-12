-- =============================================================================
-- 0200 — Tables
-- Every table: id uuid pk, created_at, updated_at (bumped by set_updated_at()).
-- Column names / nullability mirror the row types in lib/db/types.ts.
--
-- Conventions
--   * Money: numeric(12,2). Rates/percentages: numeric with explicit scale.
--   * Clock times ("HH:MM", 24h) are text with a regex check so they round-trip
--     through supabase-js exactly as "08:00" (a Postgres `time` would return "08:00:00").
--   * Dates are `date` (arrive as "YYYY-MM-DD"); instants are timestamptz.
--   * Weekday: smallint 0..6, 0 = Sunday (matches JS Date#getDay()).
-- =============================================================================

-- Shared trigger: bump updated_at on every UPDATE. Attached to every table at the
-- bottom of this file.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- settings — exactly one row (id 00000000-0000-0000-0000-000000000001).
-- Created first so profiles can default hourly_rate from settings.default_wage.
-- -----------------------------------------------------------------------------
create table public.settings (
  id                          uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  ai_monthly_cap              numeric(10,2),                 -- TODO [CAP $]: null = no cap configured yet
  default_wage                numeric(8,2)  not null default 15,
  margin                      numeric(4,3)  not null default 0.50,
  min_job_price               numeric(10,2),                 -- TODO [MIN PRICE]
  card_fee_pct                numeric(6,4)  not null default 0.029,
  card_fee_fixed              numeric(6,2)  not null default 0.30,
  drop_notice_hours           integer       not null default 24,
  autopilot                   jsonb         not null default '{
      "ad":           {"enabled": false},
      "quote":        {"enabled": false, "max_total": null},
      "custom_item":  {"enabled": false},
      "booking":      {"enabled": false},
      "followup":     {"enabled": false},
      "crew_change":  {"enabled": false},
      "drop":         {"enabled": false},
      "weather_hold": {"enabled": false}
    }'::jsonb,
  quote_valid_days            integer       not null default 14,
  base_lat                    double precision,
  base_lng                    double precision,
  partner_tree_service_name   text,                          -- TODO [PARTNER TREE SERVICE]
  partner_tree_service_email  text,

  -- Single-row guarantee: the PK can only ever hold this one value.
  constraint settings_singleton       check (id = '00000000-0000-0000-0000-000000000001'::uuid),
  constraint settings_margin_range    check (margin >= 0 and margin <= 0.95),
  constraint settings_wage_positive   check (default_wage >= 0),
  constraint settings_cap_positive    check (ai_monthly_cap is null or ai_monthly_cap >= 0),
  constraint settings_min_price       check (min_job_price is null or min_job_price >= 0),
  constraint settings_card_fee_pct    check (card_fee_pct >= 0 and card_fee_pct < 1),
  constraint settings_card_fee_fixed  check (card_fee_fixed >= 0),
  constraint settings_drop_notice     check (drop_notice_hours >= 0),
  constraint settings_quote_valid     check (quote_valid_days > 0),
  constraint settings_autopilot_obj   check (jsonb_typeof(autopilot) = 'object'),
  constraint settings_base_lat        check (base_lat is null or base_lat between -90 and 90),
  constraint settings_base_lng        check (base_lng is null or base_lng between -180 and 180)
);

-- -----------------------------------------------------------------------------
-- profiles — one per auth user (owner or crew).
-- -----------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  user_id         uuid not null unique references auth.users (id) on delete cascade,
  role            public.role not null default 'crew',
  name            text not null default '',
  email           text,
  phone           text,
  max_hours_week  numeric(5,2) not null default 40,
  paused          boolean not null default false,
  -- No column default: a BEFORE INSERT trigger fills it from settings.default_wage.
  hourly_rate     numeric(8,2) not null,
  lat             double precision,
  lng             double precision,
  constraint profiles_max_hours check (max_hours_week >= 0 and max_hours_week <= 168),
  constraint profiles_rate      check (hourly_rate >= 0),
  constraint profiles_lat       check (lat is null or lat between -90 and 90),
  constraint profiles_lng       check (lng is null or lng between -180 and 180)
);
create index profiles_role_idx on public.profiles (role);

-- -----------------------------------------------------------------------------
-- services — catalogue the quote engine prices from.
-- -----------------------------------------------------------------------------
create table public.services (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  slug               text not null unique,
  name               text not null,
  active             boolean not null default true,
  auto_quote         boolean not null default true,
  default_crew_size  integer not null default 1,
  -- { base, per_acre, tree_cover: { none, light, medium, heavy } } — all minutes / multipliers
  minutes_rule       jsonb not null,
  seasonal           text not null default 'all',
  sort_order         integer not null default 0,
  constraint services_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint services_crew_size   check (default_crew_size >= 1),
  constraint services_seasonal    check (seasonal in ('spring-summer', 'fall', 'winter', 'all')),
  -- `is true` so a missing key (null) fails the check instead of passing it.
  constraint services_minutes_rule check ((
        jsonb_typeof(minutes_rule) = 'object'
    and jsonb_typeof(minutes_rule -> 'base') = 'number'
    and jsonb_typeof(minutes_rule -> 'per_acre') = 'number'
    and jsonb_typeof(minutes_rule #> '{tree_cover,none}') = 'number'
    and jsonb_typeof(minutes_rule #> '{tree_cover,light}') = 'number'
    and jsonb_typeof(minutes_rule #> '{tree_cover,medium}') = 'number'
    and jsonb_typeof(minutes_rule #> '{tree_cover,heavy}') = 'number'
  ) is true)
);
create index services_active_idx on public.services (active, sort_order);

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  name               text not null,
  email              text,
  phone              text,
  address            text,
  lat                double precision,
  lng                double precision,
  parcel_id          text,
  lot_acres          numeric(8,3),
  tree_cover         text,
  email_opt_in       boolean not null default false,
  sms_opt_in         boolean not null default false,
  snow_list          boolean not null default false,
  notes              text,
  -- Random 32-hex token used in unsubscribe links (gen_random_uuid is core in PG13+).
  unsubscribe_token  text not null default replace(gen_random_uuid()::text, '-', '') unique,
  constraint customers_tree_cover check (tree_cover is null or tree_cover in ('none', 'light', 'medium', 'heavy')),
  constraint customers_lot_acres  check (lot_acres is null or lot_acres >= 0),
  constraint customers_lat        check (lat is null or lat between -90 and 90),
  constraint customers_lng        check (lng is null or lng between -180 and 180)
);
-- Lookup indexes for "upsert customer" on the quote form (not unique: two
-- properties can share one email).
create index customers_email_idx on public.customers (lower(email));
create index customers_phone_idx on public.customers (phone);
create index customers_snow_list_idx on public.customers (snow_list) where snow_list;

-- -----------------------------------------------------------------------------
-- leads — one per quote-form submission.
-- -----------------------------------------------------------------------------
create table public.leads (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  customer_id            uuid not null references public.customers (id) on delete cascade,
  source                 text not null default 'web',
  utm                    jsonb not null default '{}'::jsonb,
  requested_service_ids  uuid[] not null default '{}',   -- services.id values (arrays can't carry FKs)
  custom_request         text,
  photo_paths            text[] not null default '{}',   -- object paths inside the private lead-photos bucket
  preferred_days         smallint[] not null default '{}',
  status                 public.lead_status not null default 'new',
  constraint leads_utm_obj        check (jsonb_typeof(utm) = 'object'),
  constraint leads_preferred_days check (preferred_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint leads_photo_count    check (coalesce(array_length(photo_paths, 1), 0) <= 10)
);
create index leads_customer_idx on public.leads (customer_id);
create index leads_status_idx   on public.leads (status);

-- -----------------------------------------------------------------------------
-- quotes
-- -----------------------------------------------------------------------------
create table public.quotes (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  lead_id                   uuid not null references public.leads (id) on delete cascade,
  customer_id               uuid not null references public.customers (id) on delete cascade,
  status                    public.quote_status not null default 'draft',
  price_total               numeric(12,2) not null default 0,
  labor_total               numeric(12,2) not null default 0,
  fee_total                 numeric(12,2) not null default 0,
  profit_total              numeric(12,2) not null default 0,
  margin                    numeric(4,3)  not null default 0.50,
  wage                      numeric(8,2)  not null default 15,
  stripe_checkout_id        text unique,
  stripe_checkout_url       text,
  stripe_payment_intent_id  text,
  sent_at                   timestamptz,
  accepted_at               timestamptz,
  expires_at                timestamptz,
  rationale                 text,
  constraint quotes_margin_range check (margin >= 0 and margin <= 0.95),
  constraint quotes_wage         check (wage >= 0),
  constraint quotes_totals       check (price_total >= 0 and labor_total >= 0 and fee_total >= 0)
);
create index quotes_lead_idx     on public.quotes (lead_id);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_status_idx   on public.quotes (status);
create index quotes_payment_intent_idx on public.quotes (stripe_payment_intent_id);

-- -----------------------------------------------------------------------------
-- quote_items — service_id null = custom request.
-- -----------------------------------------------------------------------------
create table public.quote_items (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  quote_id      uuid not null references public.quotes (id) on delete cascade,
  service_id    uuid references public.services (id) on delete restrict,
  description   text not null,
  is_custom     boolean not null default false,
  crew_size     integer not null default 1,
  est_hours     numeric(6,2) not null default 0,
  price         numeric(12,2),
  status        public.quote_item_status not null default 'auto',
  partner_note  text,
  ai_summary    jsonb,   -- owner-only Claude summary + suggested range; never sent
  sort_order    integer not null default 0,
  constraint quote_items_service_or_custom check (is_custom or service_id is not null),
  constraint quote_items_crew_size check (crew_size >= 1),
  constraint quote_items_hours     check (est_hours >= 0),
  constraint quote_items_price     check (price is null or price >= 0),
  constraint quote_items_ai_summary check (ai_summary is null or jsonb_typeof(ai_summary) = 'object')
);
create index quote_items_quote_idx   on public.quote_items (quote_id, sort_order);
create index quote_items_service_idx on public.quote_items (service_id);
create index quote_items_status_idx  on public.quote_items (status);

-- -----------------------------------------------------------------------------
-- jobs
-- -----------------------------------------------------------------------------
create table public.jobs (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  quote_id                uuid references public.quotes (id) on delete set null,
  customer_id             uuid not null references public.customers (id) on delete cascade,
  status                  public.job_status not null default 'unscheduled',
  start_at                timestamptz,
  end_at                  timestamptz,
  est_minutes             integer not null default 0,
  crew_size               integer not null default 1,
  paid                    boolean not null default false,
  weather_hold            boolean not null default false,
  paid_at                 timestamptz,
  deadline                timestamptz,
  schedule_reason         text,
  actual_minutes          integer,
  started_at              timestamptz,
  completed_at            timestamptz,
  completion_photo_paths  text[] not null default '{}',
  notes                   text,
  constraint jobs_window        check (start_at is null or end_at is null or end_at > start_at),
  constraint jobs_est_minutes   check (est_minutes >= 0),
  constraint jobs_crew_size     check (crew_size >= 1),
  constraint jobs_actual        check (actual_minutes is null or actual_minutes >= 0)
);
create index jobs_quote_idx    on public.jobs (quote_id);
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_status_idx   on public.jobs (status);
create index jobs_start_idx    on public.jobs (start_at);

-- -----------------------------------------------------------------------------
-- job_assignments — crew_id references profiles.id (not auth user id).
-- -----------------------------------------------------------------------------
create table public.job_assignments (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  job_id           uuid not null references public.jobs (id) on delete cascade,
  crew_id          uuid not null references public.profiles (id) on delete cascade,
  status           public.assignment_status not null default 'offered',
  responded_at     timestamptz,
  swap_to_crew_id  uuid references public.profiles (id) on delete set null,
  constraint job_assignments_unique unique (job_id, crew_id),
  constraint job_assignments_swap_self check (swap_to_crew_id is null or swap_to_crew_id <> crew_id)
);
create index job_assignments_crew_idx   on public.job_assignments (crew_id, status);
create index job_assignments_status_idx on public.job_assignments (status);
create index job_assignments_swap_idx   on public.job_assignments (swap_to_crew_id);

-- -----------------------------------------------------------------------------
-- owner_windows / owner_exceptions — when the owner can run jobs.
-- -----------------------------------------------------------------------------
create table public.owner_windows (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  weekday     smallint not null,
  start_time  text not null,
  end_time    text not null,
  constraint owner_windows_weekday check (weekday between 0 and 6),
  constraint owner_windows_start   check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint owner_windows_end     check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint owner_windows_order   check (end_time > start_time)
);
create index owner_windows_weekday_idx on public.owner_windows (weekday);

create table public.owner_exceptions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  date        date not null,
  closed      boolean not null default true,
  start_time  text,
  end_time    text,
  note        text,
  constraint owner_exceptions_start check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint owner_exceptions_end   check (end_time   is null or end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint owner_exceptions_pair  check ((start_time is null) = (end_time is null)),
  constraint owner_exceptions_order check (start_time is null or end_time > start_time)
);
create index owner_exceptions_date_idx on public.owner_exceptions (date);

-- -----------------------------------------------------------------------------
-- crew_availability — many blocks per weekday allowed.
-- -----------------------------------------------------------------------------
create table public.crew_availability (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  crew_id     uuid not null references public.profiles (id) on delete cascade,
  weekday     smallint not null,
  start_time  text not null,
  end_time    text not null,
  constraint crew_availability_weekday check (weekday between 0 and 6),
  constraint crew_availability_start   check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint crew_availability_end     check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint crew_availability_order   check (end_time > start_time)
);
create index crew_availability_crew_idx on public.crew_availability (crew_id, weekday);

-- -----------------------------------------------------------------------------
-- crew_exceptions — time off ("off") or extra availability ("extra").
-- -----------------------------------------------------------------------------
create table public.crew_exceptions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  crew_id     uuid not null references public.profiles (id) on delete cascade,
  date_from   date not null,
  date_to     date not null,
  start_time  text,   -- null start/end = whole day(s)
  end_time    text,
  kind        public.exception_kind not null default 'off',
  status      public.exception_status not null default 'pending',
  note        text,
  constraint crew_exceptions_dates check (date_to >= date_from),
  constraint crew_exceptions_start check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint crew_exceptions_end   check (end_time   is null or end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint crew_exceptions_pair  check ((start_time is null) = (end_time is null)),
  constraint crew_exceptions_order check (start_time is null or end_time > start_time)
);
create index crew_exceptions_crew_idx   on public.crew_exceptions (crew_id, date_from);
create index crew_exceptions_status_idx on public.crew_exceptions (status);

-- -----------------------------------------------------------------------------
-- approvals — the owner inbox.
-- -----------------------------------------------------------------------------
create table public.approvals (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  kind           public.approval_kind not null,
  ref_table      text not null,
  ref_id         uuid not null,
  payload        jsonb not null default '{}'::jsonb,
  status         public.approval_status not null default 'pending',
  created_by     text not null,     -- worker name or user id
  decided_at     timestamptz,
  decided_by     text,              -- owner user id, or 'autopilot'
  decision_note  text,
  title          text not null,
  summary        text,
  constraint approvals_payload_obj check (jsonb_typeof(payload) = 'object')
);
create index approvals_status_idx on public.approvals (status, created_at desc);
create index approvals_kind_idx   on public.approvals (kind, status);
create index approvals_ref_idx    on public.approvals (ref_table, ref_id);

-- -----------------------------------------------------------------------------
-- ads
-- -----------------------------------------------------------------------------
create table public.ads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  channel     public.ad_channel not null,
  headline    text not null,
  body        text not null,
  cta         text,
  image_path  text,
  targeting   jsonb not null default '{}'::jsonb,
  utm_code    text not null unique,
  status      public.ad_status not null default 'draft',
  season      text,
  offer       text,
  posted_at   timestamptz,
  constraint ads_targeting_obj check (jsonb_typeof(targeting) = 'object')
);
create index ads_status_idx on public.ads (status);

-- -----------------------------------------------------------------------------
-- messages — outbound email/SMS (drafted, queued, sent).
-- -----------------------------------------------------------------------------
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  job_id       uuid references public.jobs (id) on delete set null,
  quote_id     uuid references public.quotes (id) on delete set null,
  channel      public.message_channel not null,
  kind         public.message_kind not null,
  subject      text,
  body         text not null,
  status       public.message_status not null default 'draft',
  sent_at      timestamptz,
  error        text,
  provider_id  text
);
create index messages_customer_idx on public.messages (customer_id, created_at desc);
create index messages_job_idx      on public.messages (job_id);
create index messages_quote_idx    on public.messages (quote_id);
create index messages_status_idx   on public.messages (status);

-- -----------------------------------------------------------------------------
-- payouts — cash owed to crew per job.
-- -----------------------------------------------------------------------------
create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  crew_id       uuid not null references public.profiles (id) on delete restrict,
  job_id        uuid not null references public.jobs (id) on delete restrict,
  hours         numeric(6,2) not null,
  rate          numeric(8,2) not null,
  amount        numeric(12,2) not null,
  paid_cash_at  timestamptz,
  constraint payouts_unique unique (crew_id, job_id),
  constraint payouts_values check (hours >= 0 and rate >= 0 and amount >= 0)
);
create index payouts_job_idx    on public.payouts (job_id);
create index payouts_unpaid_idx on public.payouts (crew_id) where paid_cash_at is null;

-- -----------------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------------
create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  date        date not null default current_date,
  category    text not null,
  amount      numeric(12,2) not null,
  note        text,
  constraint expenses_amount check (amount >= 0)
);
create index expenses_date_idx on public.expenses (date);

-- -----------------------------------------------------------------------------
-- ai_usage — one row per Anthropic API call (logged by lib/ai/claude.ts).
-- -----------------------------------------------------------------------------
create table public.ai_usage (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  task                text not null,
  model               text not null,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  est_cost            numeric(12,6) not null default 0,
  worker              text,
  constraint ai_usage_tokens check (input_tokens >= 0 and output_tokens >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0),
  constraint ai_usage_cost   check (est_cost >= 0)
);
create index ai_usage_created_idx on public.ai_usage (created_at);

-- -----------------------------------------------------------------------------
-- fleet_workers — heartbeat table, one row per box.
-- -----------------------------------------------------------------------------
create table public.fleet_workers (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  name            text not null unique,
  role            public.fleet_role not null,
  last_heartbeat  timestamptz,
  cpu             real,
  ram             real,
  temp_c          real,
  current_task    text,
  last_error      text,
  version         text
);
create index fleet_workers_role_idx on public.fleet_workers (role);

-- -----------------------------------------------------------------------------
-- fleet_tasks — the work queue. Claimed with claim_task() (FOR UPDATE SKIP LOCKED).
-- -----------------------------------------------------------------------------
create table public.fleet_tasks (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  type          public.fleet_task_type not null,
  role          public.fleet_role not null,
  payload       jsonb not null default '{}'::jsonb,
  status        public.fleet_task_status not null default 'queued',
  worker        text,
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  run_after     timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  result        jsonb,
  error         text,
  dedupe_key    text,
  constraint fleet_tasks_attempts check (attempts >= 0 and max_attempts >= 1),
  constraint fleet_tasks_payload_obj check (jsonb_typeof(payload) = 'object')
);
-- The claim query: status = 'queued' and role = $1 and run_after <= now().
create index fleet_tasks_claim_idx on public.fleet_tasks (status, role, run_after);
-- Idempotency: at most one task per dedupe_key (when one is given).
create unique index fleet_tasks_dedupe_key_idx on public.fleet_tasks (dedupe_key) where dedupe_key is not null;
create index fleet_tasks_running_idx on public.fleet_tasks (started_at) where status = 'running';

-- -----------------------------------------------------------------------------
-- stripe_events — webhook idempotency log.
-- -----------------------------------------------------------------------------
create table public.stripe_events (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  stripe_event_id  text not null unique,
  type             text not null,
  processed_at     timestamptz,
  payload          jsonb not null default '{}'::jsonb
);
create index stripe_events_type_idx on public.stripe_events (type);

-- -----------------------------------------------------------------------------
-- Attach set_updated_at() to every table above.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'profiles', 'services', 'customers', 'leads', 'quotes', 'quote_items',
    'jobs', 'job_assignments', 'owner_windows', 'owner_exceptions', 'crew_availability',
    'crew_exceptions', 'approvals', 'ads', 'messages', 'payouts', 'expenses', 'ai_usage',
    'fleet_workers', 'fleet_tasks', 'stripe_events'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
