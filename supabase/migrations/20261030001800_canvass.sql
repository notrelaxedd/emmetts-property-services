-- =============================================================================
-- 1800 — Canvass: door-to-door planning.
--   parcels            one row per county parcel pulled into the tab (Cuyahoga County public layer).
--                      County attributes as fetched live in `raw`; the typed columns are what the
--                      planner uses. callback_window / home_pattern / do_not_knock come from the crew
--                      and the homeowner, never from outside sources, and survive re-pulls.
--   block_groups       Census ACS 5-year aggregates per block group (12-digit GEOID) + the day-one
--                      knock window derived from them (`prior_window`). Aggregates only: never a person.
--   knocks             the knock log: one row per door, with outcome, knocker, pitch, GPS and weather.
--                      `client_id` is generated on the phone so the offline queue can re-send safely.
--   pitches            scripts the crew picks from at session start (stats are per pitch).
--   hanger_codes       one QR code per street for door hangers (/h/<code>).
--   hanger_events      scans (hashed visitor) and bookings per hanger code.
--   canvass_plans      a saved "plan my session": date, slot and the ordered parcels to hit.
--   canvass_summaries  the nightly AI digest, one per day.
--   canvass_settings   single row (id …0001): pricing, thresholds, doors/hour, season map, county
--                      field map.
-- Who sees what: owner everything; crew read parcels / block_groups / pitches / canvass_settings /
-- canvass_plans and insert + read their own knocks; hangers, summaries and everything else are
-- owner / service-role only; anon nothing.
-- =============================================================================

create type public.knock_outcome as enum (
  'no_answer', 'not_interested', 'quote_given', 'booked', 'call_back', 'no_soliciting', 'do_not_return', 'has_service'
);
create type public.hanger_event as enum ('scan', 'booking');
create type public.home_pattern as enum ('home_weekdays', 'evenings_only', 'weekends_only', 'unknown');

-- -----------------------------------------------------------------------------
-- parcels
-- -----------------------------------------------------------------------------
create table public.parcels (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  parcel_id            text not null unique,              -- county PIN
  address              text not null default '',          -- site address as the county gives it
  street               text not null default '',          -- street name only, upper-cased (hanger codes, learned layer)
  city                 text,
  zip                  text,
  owner_display        text,                              -- display / greeting only
  mailing_address      text,
  land_use             text,                              -- county land-use / class code
  lot_sqft             numeric(12,1),
  living_sqft          numeric(10,1),
  stories              numeric(4,1),
  footprint_sqft       numeric(10,1),
  year_built           integer,
  market_value         numeric(12,2),
  owner_occupied       boolean,                           -- null = unknown
  owner_is_entity      boolean not null default false,    -- LLC / trust / corp owner → landlord pitch
  geom                 jsonb,                             -- GeoJSON Polygon / MultiPolygon, WGS84
  centroid_lat         double precision,
  centroid_lng         double precision,
  block_group_geoid    text,                              -- 12-digit GEOID
  turf_sqft_est        numeric(10,1),
  turf_sqft_traced     numeric(10,1),
  turf_geom            jsonb,                             -- GeoJSON FeatureCollection of traced lawn polygons
  callback_window      text,                              -- what the homeowner said
  home_pattern         public.home_pattern,               -- set by the crew; null = not set
  do_not_knock         boolean not null default false,
  do_not_knock_reason  text,
  customer_id          uuid references public.customers (id) on delete set null,
  raw                  jsonb not null default '{}'::jsonb, -- county attributes as fetched
  fetched_at           timestamptz not null default now(),
  constraint parcels_parcel_id    check (length(trim(parcel_id)) > 0),
  constraint parcels_centroid_lat check (centroid_lat is null or centroid_lat between -90 and 90),
  constraint parcels_centroid_lng check (centroid_lng is null or centroid_lng between -180 and 180),
  constraint parcels_raw_obj      check (jsonb_typeof(raw) = 'object'),
  constraint parcels_geom_obj     check (geom is null or jsonb_typeof(geom) = 'object'),
  constraint parcels_turf_geom_obj check (turf_geom is null or jsonb_typeof(turf_geom) = 'object'),
  constraint parcels_sizes check (
        (lot_sqft         is null or lot_sqft         >= 0)
    and (living_sqft      is null or living_sqft      >= 0)
    and (stories          is null or stories          >= 0)
    and (footprint_sqft   is null or footprint_sqft   >= 0)
    and (market_value     is null or market_value     >= 0)
    and (turf_sqft_est    is null or turf_sqft_est    >= 0)
    and (turf_sqft_traced is null or turf_sqft_traced >= 0)
  )
);
create index parcels_block_group_idx on public.parcels (block_group_geoid);
create index parcels_street_idx      on public.parcels (street);
create index parcels_centroid_idx    on public.parcels (centroid_lat, centroid_lng);
create index parcels_customer_idx    on public.parcels (customer_id) where customer_id is not null;

-- -----------------------------------------------------------------------------
-- block_groups — ACS aggregates, cached per GEOID.
-- -----------------------------------------------------------------------------
create table public.block_groups (
  id                         uuid primary key default gen_random_uuid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  geoid                      text not null unique,
  geom                       jsonb,                      -- GeoJSON polygon from TIGERweb; null until fetched
  pct_not_in_lf              numeric(5,4),               -- B23025: not in labor force / total
  pct_hh_nonworking_parent   numeric(5,4),               -- B23007: families with a parent not in the labor force
  pct_65_plus                numeric(5,4),               -- B01001
  median_hh_income           numeric(12,2),              -- B19013 (display only)
  depart_dist                jsonb not null default '{}'::jsonb,  -- B08302 { "<bucket label>": count }
  commute_dist               jsonb not null default '{}'::jsonb,  -- B08303 { "<bucket label>": count }
  prior_window               jsonb,                      -- PriorWindow (lib/canvass/types.ts)
  acs_vintage                text,                       -- e.g. "2023"
  fetched_at                 timestamptz,
  constraint block_groups_geoid       check (geoid ~ '^[0-9]{12}$'),
  constraint block_groups_geom_obj    check (geom is null or jsonb_typeof(geom) = 'object'),
  constraint block_groups_depart_obj  check (jsonb_typeof(depart_dist) = 'object'),
  constraint block_groups_commute_obj check (jsonb_typeof(commute_dist) = 'object'),
  constraint block_groups_prior_obj   check (prior_window is null or jsonb_typeof(prior_window) = 'object'),
  constraint block_groups_pcts check (
        (pct_not_in_lf            is null or pct_not_in_lf            between 0 and 1)
    and (pct_hh_nonworking_parent is null or pct_hh_nonworking_parent between 0 and 1)
    and (pct_65_plus              is null or pct_65_plus              between 0 and 1)
    and (median_hh_income         is null or median_hh_income         >= 0)
  )
);

-- -----------------------------------------------------------------------------
-- pitches — before knocks (FK).
-- -----------------------------------------------------------------------------
create table public.pitches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text not null,
  script      text not null default '',
  active      boolean not null default true,
  sort_order  integer not null default 0,
  constraint pitches_name check (length(trim(name)) > 0)
);
create index pitches_active_idx on public.pitches (active, sort_order);

-- -----------------------------------------------------------------------------
-- knocks — the knock log.
-- -----------------------------------------------------------------------------
create table public.knocks (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  parcel_id        uuid not null references public.parcels (id) on delete cascade,
  knocked_at       timestamptz not null default now(),
  knocker_id       uuid not null references public.profiles (id) on delete restrict,
  outcome          public.knock_outcome not null,
  pitch_id         uuid references public.pitches (id) on delete set null,
  lat              double precision,
  lng              double precision,
  weather          jsonb,                                -- KnockWeather { temp_f, precip_in, code, label } or null
  notes            text,
  callback_window  text,                                 -- what they said at this knock (also copied onto the parcel)
  home_pattern     public.home_pattern,
  quote_low        numeric(10,2),
  quote_high       numeric(10,2),
  lead_id          uuid references public.leads (id) on delete set null,
  quote_id         uuid references public.quotes (id) on delete set null,
  client_id        text unique,                          -- uuid generated on the phone: offline sync is idempotent
  constraint knocks_lat         check (lat is null or lat between -90 and 90),
  constraint knocks_lng         check (lng is null or lng between -180 and 180),
  constraint knocks_weather_obj check (weather is null or jsonb_typeof(weather) = 'object'),
  constraint knocks_quote       check ((quote_low is null or quote_low >= 0) and (quote_high is null or quote_high >= 0))
);
create index knocks_parcel_idx  on public.knocks (parcel_id, knocked_at desc);
create index knocks_knocker_idx on public.knocks (knocker_id);
create index knocks_time_idx    on public.knocks (knocked_at);

-- -----------------------------------------------------------------------------
-- hanger_codes / hanger_events — door hanger QR codes per street.
-- -----------------------------------------------------------------------------
create table public.hanger_codes (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  code               text not null unique,
  street             text not null,
  block_group_geoid  text,
  active             boolean not null default true,
  constraint hanger_codes_code   check (code ~ '^[A-Z0-9]{4,8}$'),
  constraint hanger_codes_street check (length(trim(street)) > 0)
);
create index hanger_codes_street_idx on public.hanger_codes (street);

create table public.hanger_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  code        text not null references public.hanger_codes (code) on delete cascade,
  event       public.hanger_event not null,
  visitor     text,                                      -- sha256(ip|ua) truncated; scans only
  lead_id     uuid references public.leads (id) on delete set null  -- bookings
);
create index hanger_events_code_idx on public.hanger_events (code, event, created_at);

-- -----------------------------------------------------------------------------
-- canvass_plans — a saved session plan.
-- -----------------------------------------------------------------------------
create table public.canvass_plans (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  for_date    date not null,
  slot_start  text not null,                             -- "HH:MM"
  slot_end    text not null,
  parcel_ids  uuid[] not null default '{}',
  created_by  uuid references public.profiles (id) on delete set null,
  notes       text,
  constraint canvass_plans_start check (slot_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint canvass_plans_end   check (slot_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
create index canvass_plans_date_idx on public.canvass_plans (for_date);

-- -----------------------------------------------------------------------------
-- canvass_summaries — nightly digest, one per day.
-- -----------------------------------------------------------------------------
create table public.canvass_summaries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  for_date    date not null unique,
  summary     jsonb not null,
  model       text,
  constraint canvass_summaries_summary_obj check (jsonb_typeof(summary) = 'object')
);

-- -----------------------------------------------------------------------------
-- canvass_settings — exactly one row (id 00000000-0000-0000-0000-000000000001).
-- -----------------------------------------------------------------------------
create table public.canvass_settings (
  id                                   uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now(),
  hardscape_pct                        numeric(4,3) not null default 0.12,
  rate_per_1000_sqft                   numeric(8,2) not null default 6.00,
  min_charge                           numeric(8,2) not null default 40,
  base_prices                          jsonb not null default '{"mow":35,"edge":15,"leaf_cleanup":150,"gutters":120,"snow":45}'::jsonb,
  value_tier_enabled                   boolean not null default false,
  value_tier_max                       numeric(4,3) not null default 1.10,
  doors_per_hour                       integer not null default 25,
  neighbor_n                           integer not null default 3,
  recency_days                         integer not null default 14,
  daytime_not_in_lf_threshold          numeric(4,3) not null default 0.40,
  daytime_nonworking_parent_threshold  numeric(4,3) not null default 0.35,
  work_hours                           numeric(4,2) not null default 8.5,
  learned_min_knocks                   integer not null default 8,
  season_map                           jsonb not null default '{"1":"snow","2":"snow","3":"snow","4":"mow","5":"mow","6":"mow","7":"mow","8":"mow","9":"leaf_cleanup","10":"leaf_cleanup","11":"leaf_cleanup","12":"snow"}'::jsonb,
  residential_land_use_prefixes        text[] not null default '{"510","511","512","513","514","515","516","517","518","519"}',
  parcel_field_map                     jsonb not null default '{}'::jsonb,   -- discovered from the county layer + owner overrides
  acs_vintage                          text not null default '2023',
  offer_text                           text,                                 -- season offer on hangers; null = default copy

  -- Single-row guarantee: the PK can only ever hold this one value.
  constraint canvass_settings_singleton        check (id = '00000000-0000-0000-0000-000000000001'::uuid),
  constraint canvass_settings_hardscape        check (hardscape_pct >= 0 and hardscape_pct < 1),
  constraint canvass_settings_rate             check (rate_per_1000_sqft >= 0),
  constraint canvass_settings_min_charge       check (min_charge >= 0),
  constraint canvass_settings_value_tier_max   check (value_tier_max >= 1.0 and value_tier_max <= 1.10),
  constraint canvass_settings_doors_per_hour   check (doors_per_hour > 0),
  constraint canvass_settings_neighbor_n       check (neighbor_n >= 0),
  constraint canvass_settings_recency_days     check (recency_days >= 0),
  constraint canvass_settings_thresholds       check (daytime_not_in_lf_threshold between 0 and 1
                                                      and daytime_nonworking_parent_threshold between 0 and 1),
  constraint canvass_settings_work_hours       check (work_hours >= 0 and work_hours <= 24),
  constraint canvass_settings_learned_min      check (learned_min_knocks >= 1),
  constraint canvass_settings_base_prices_obj  check (jsonb_typeof(base_prices) = 'object'),
  constraint canvass_settings_season_map_obj   check (jsonb_typeof(season_map) = 'object'),
  constraint canvass_settings_field_map_obj    check (jsonb_typeof(parcel_field_map) = 'object'),
  constraint canvass_settings_acs_vintage      check (acs_vintage ~ '^[0-9]{4}$')
);

-- -----------------------------------------------------------------------------
-- updated_at trigger, RLS (owner all) and no anon privileges, as in 0200 / 0500.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'parcels', 'block_groups', 'pitches', 'knocks', 'hanger_codes', 'hanger_events',
    'canvass_plans', 'canvass_summaries', 'canvass_settings'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using ((select public.is_owner())) with check ((select public.is_owner()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- Crew: read what the logger needs; write only their own knocks.
do $$
declare
  t text;
begin
  foreach t in array array['parcels', 'block_groups', 'pitches', 'canvass_settings', 'canvass_plans'] loop
    execute format('create policy crew_select on public.%I for select to authenticated using (true)', t);
  end loop;
end;
$$;

create policy crew_insert_own on public.knocks
  for insert to authenticated
  with check (knocker_id = (select public.current_profile_id()));
create policy crew_select_own on public.knocks
  for select to authenticated
  using (knocker_id = (select public.current_profile_id()));

-- No crew policies on: hanger_codes, hanger_events, canvass_summaries (owner / service role only).

-- -----------------------------------------------------------------------------
-- Seeds: the settings row (all defaults) and three starter pitches.
-- -----------------------------------------------------------------------------
insert into public.canvass_settings (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.pitches (name, script, sort_order)
select * from (values
  ('Neighbor special', 'Hi, I''m with Emmett''s Property Services. We already take care of a few lawns on this street, so we can fit yours in on the same trip and pass the savings on. Can I give you a quick price?', 10),
  ('Season focus', 'Hi, I''m with Emmett''s Property Services. We''re booking this season''s work on your street this week. It takes thirty seconds for me to give you a price for your yard. Want one?', 20),
  ('Landlord / rental', 'Hi, I''m with Emmett''s Property Services. We keep rentals looking good between tenants with scheduled visits and photo check-ins. Can I leave a price for the owner?', 30)
) as v (name, script, sort_order)
where not exists (select 1 from public.pitches);

comment on table public.parcels is
  'County parcels pulled into the Canvass tab. Typed columns feed the planner; raw holds the county attributes. callback_window / home_pattern / do_not_knock come from the crew and the homeowner and survive re-pulls.';
comment on column public.parcels.owner_display is 'Owner name from the county record. Display / greeting only.';
comment on column public.parcels.do_not_knock is 'Set by a No Soliciting sign or a homeowner request. Respected forever: never in a route or plan.';
comment on column public.parcels.raw is 'County attributes as fetched (object). Field names come from canvass_settings.parcel_field_map.';
comment on table public.block_groups is
  'Census ACS 5-year aggregates per block group (12-digit GEOID). Aggregates only; prior_window is the day-one knock window derived from them.';
comment on column public.block_groups.pct_hh_nonworking_parent is
  'B23007: families with own children under 18 where a parent is not in the labor force, over all families with own children under 18.';
comment on table public.knocks is 'One row per door knocked: outcome, knocker, pitch, GPS, weather, what the homeowner said.';
comment on column public.knocks.client_id is 'UUID generated on the phone; unique so the offline queue can re-send without duplicates.';
comment on table public.hanger_codes is 'One QR code per street printed on door hangers; the landing page is /h/<code>.';
comment on column public.hanger_events.visitor is 'sha256 of ip + user agent (truncated): counts unique scanners without storing the ip. Scans only.';
comment on table public.canvass_plans is 'A saved "plan my session": the date, the slot and the parcels in walking order.';
comment on table public.canvass_summaries is 'Nightly AI digest of the previous day''s knocks, one row per day.';
comment on table public.canvass_settings is 'Single row (id …0001): canvass pricing, thresholds, doors/hour, season map and the county field map.';
comment on column public.canvass_settings.parcel_field_map is
  'County layer field map: discovered at runtime from /MapServer/1?f=pjson, with owner overrides from Settings.';
