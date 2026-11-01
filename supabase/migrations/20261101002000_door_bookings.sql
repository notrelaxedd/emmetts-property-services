-- =============================================================================
-- 2000 — Door-to-door bookings (/door).
--   door_bookings  one row per job a rep books on the porch: who, their phone (digits only), the
--                  street address, the day we're going and what we're doing. Written by the /door
--                  server action through the service role; no customer / lead / quote rows are
--                  created (it's a flat list the owner works from). Owner-only, like every ops
--                  table: crew and anon see none of it.
-- =============================================================================

create table public.door_bookings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text not null,
  phone       text not null,                 -- 10 digits, no formatting
  address     text not null,                 -- street address only
  job_date    date not null,                 -- the day we're going
  services    text[] not null,               -- door-schema.ts keys: leaves_front, leaves_back, mowing, edging
  constraint door_bookings_name     check (length(trim(name)) between 1 and 120),
  constraint door_bookings_phone    check (phone ~ '^[0-9]{10}$'),
  constraint door_bookings_address  check (length(trim(address)) between 1 and 200),
  constraint door_bookings_services check (
    cardinality(services) >= 1
    and services <@ array['leaves_front', 'leaves_back', 'mowing', 'edging']::text[]
  )
);
create index door_bookings_job_date_idx on public.door_bookings (job_date, created_at);

-- updated_at trigger, RLS (owner only) and no anon privileges, as in 0200 / 0500.
create trigger set_updated_at before update on public.door_bookings
  for each row execute function public.set_updated_at();
alter table public.door_bookings enable row level security;
create policy owner_all on public.door_bookings for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.door_bookings from anon;

comment on table public.door_bookings is
  'Jobs booked at the door by a rep (/door): name, phone (digits only), street address, the day and the services. Flat list; not linked to customers or quotes.';
comment on column public.door_bookings.services is
  'Service keys from lib/door-schema.ts: leaves_front, leaves_back, mowing, edging. At least one.';
