-- =============================================================================
-- 2400 — Mowing tab: recurring weekly / biweekly lawn cuts.
--   mow_settings   single row (id …0001): default price per cut, minutes per yard, drive speed,
--                  route start time.
--   mow_customers  one row per customer on a mowing schedule: weekly or biweekly, price per cut,
--                  minutes, the week their schedule counts from (biweekly alternates from it),
--                  preferred weekday, how they pay, active.
--   mow_cuts       the cut log: one row per mow, with the price at the time.
--   mow_routes     a saved day's route (shown on the Jobs calendar).
--   mow_bills      one bill per customer per month (pay method, paid), like snow_bills.
-- Owner only (RLS), nothing for crew or anon.
-- =============================================================================

create type public.mow_frequency as enum ('weekly', 'biweekly');

create table public.mow_settings (
  id               uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  default_price    numeric(10,2) not null default 40,
  default_minutes  integer not null default 30,
  drive_mph        numeric(5,1) not null default 25,
  start_time       time not null default '08:00',
  constraint mow_settings_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid),
  constraint mow_settings_price     check (default_price >= 0),
  constraint mow_settings_minutes   check (default_minutes between 1 and 480),
  constraint mow_settings_mph       check (drive_mph > 0 and drive_mph <= 80)
);

create table public.mow_customers (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  customer_id     uuid not null unique references public.customers (id) on delete cascade,
  frequency       public.mow_frequency not null default 'weekly',
  price           numeric(10,2) not null,
  est_minutes     integer,
  anchor_date     date not null default current_date,
  preferred_day   smallint,
  notes           text,
  active          boolean not null default true,
  pay_method      text,
  constraint mow_customers_price      check (price >= 0),
  constraint mow_customers_minutes    check (est_minutes is null or est_minutes between 1 and 480),
  constraint mow_customers_day        check (preferred_day is null or preferred_day between 0 and 6),
  constraint mow_customers_pay_method check (pay_method is null or pay_method in ('cash', 'card', 'check'))
);

create table public.mow_cuts (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  mow_customer_id  uuid not null references public.mow_customers (id) on delete cascade,
  cut_at           timestamptz not null default now(),
  price            numeric(10,2) not null,
  logged_by        text,
  note             text,
  constraint mow_cuts_price check (price >= 0)
);
create index mow_cuts_customer_idx on public.mow_cuts (mow_customer_id, cut_at desc);
create index mow_cuts_at_idx on public.mow_cuts (cut_at desc);

create table public.mow_routes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  run_date    date not null,
  start_at    timestamptz not null,
  finish_at   timestamptz not null,
  trucks      integer not null default 1,
  stops       jsonb not null default '[]'::jsonb,
  constraint mow_routes_trucks check (trucks between 1 and 5),
  constraint mow_routes_stops  check (jsonb_typeof(stops) = 'array')
);
create index mow_routes_date_idx on public.mow_routes (run_date);

create table public.mow_bills (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  mow_customer_id  uuid not null references public.mow_customers (id) on delete cascade,
  month            date not null,
  amount           numeric(10,2) not null default 0,
  cuts             integer not null default 0,
  pay_method       text,
  paid_at          timestamptz,
  constraint mow_bills_month      check (extract(day from month) = 1),
  constraint mow_bills_pay_method check (pay_method is null or pay_method in ('cash', 'card', 'check')),
  constraint mow_bills_amount     check (amount >= 0),
  unique (mow_customer_id, month)
);
create index mow_bills_month_idx on public.mow_bills (month);

do $$
declare
  t text;
begin
  foreach t in array array['mow_settings', 'mow_customers', 'mow_cuts', 'mow_routes', 'mow_bills'] loop
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

insert into public.mow_settings (id) values ('00000000-0000-0000-0000-000000000001') on conflict (id) do nothing;
