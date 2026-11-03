-- =============================================================================
-- 2100 — Snow removal tab.
--   snow_settings   single row (id …0001): monthly plan prices (low / medium / high), optional pushes
--                   included per month, the "finish every driveway by" time, minutes per driveway and
--                   drive speed for the route planner.
--   snow_customers  one row per customer on a snow plan: plan tier or per-push with its own price,
--                   minutes per driveway (overrides the default), notes, active.
--   snow_pushes     the push log: one row per plow visit, with the per-push price at the time.
--   snow_routes     a saved route for a morning: ordered stops per truck, start time, finish-by. These
--                   show on the Jobs calendar for that day.
-- Who sees what: owner everything; crew and anon nothing.
-- =============================================================================

create type public.snow_plan as enum ('low', 'medium', 'high', 'per_push');

create table public.snow_settings (
  id               uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  low_price        numeric(10,2) not null default 60,
  medium_price     numeric(10,2) not null default 100,
  high_price       numeric(10,2) not null default 150,
  low_pushes       integer,              -- pushes included per month; null = unlimited
  medium_pushes    integer,
  high_pushes      integer,
  default_per_push numeric(10,2) not null default 35,
  finish_by        time not null default '06:30',
  default_minutes  integer not null default 15,
  drive_mph        numeric(5,1) not null default 20,
  trigger_inches   numeric(4,1) not null default 2,
  constraint snow_settings_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid),
  constraint snow_settings_prices    check (low_price >= 0 and medium_price >= 0 and high_price >= 0 and default_per_push >= 0),
  constraint snow_settings_pushes    check (coalesce(low_pushes, 0) >= 0 and coalesce(medium_pushes, 0) >= 0 and coalesce(high_pushes, 0) >= 0),
  constraint snow_settings_minutes   check (default_minutes between 1 and 240),
  constraint snow_settings_mph       check (drive_mph > 0 and drive_mph <= 80)
);

create table public.snow_customers (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  customer_id     uuid not null unique references public.customers (id) on delete cascade,
  plan            public.snow_plan not null default 'medium',
  per_push_price  numeric(10,2),
  est_minutes     integer,
  notes           text,
  active          boolean not null default true,
  constraint snow_customers_per_push check (plan <> 'per_push' or per_push_price is not null),
  constraint snow_customers_price    check (per_push_price is null or per_push_price >= 0),
  constraint snow_customers_minutes  check (est_minutes is null or est_minutes between 1 and 240)
);

create table public.snow_pushes (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  snow_customer_id  uuid not null references public.snow_customers (id) on delete cascade,
  pushed_at         timestamptz not null default now(),
  price             numeric(10,2),        -- per-push price when logged; null on a monthly plan
  logged_by         text,
  note              text
);
create index snow_pushes_customer_idx on public.snow_pushes (snow_customer_id, pushed_at desc);
create index snow_pushes_at_idx on public.snow_pushes (pushed_at desc);

create table public.snow_routes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  run_date    date not null,
  start_at    timestamptz not null,
  finish_at   timestamptz not null,
  trucks      integer not null default 1,
  stops       jsonb not null default '[]'::jsonb,
  note        text,
  constraint snow_routes_trucks check (trucks between 1 and 5),
  constraint snow_routes_stops  check (jsonb_typeof(stops) = 'array')
);
create index snow_routes_date_idx on public.snow_routes (run_date);

do $$
declare
  t text;
begin
  foreach t in array array['snow_settings', 'snow_customers', 'snow_pushes', 'snow_routes'] loop
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

insert into public.snow_settings (id) values ('00000000-0000-0000-0000-000000000001') on conflict (id) do nothing;
