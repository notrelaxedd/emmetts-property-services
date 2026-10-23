-- =============================================================================
-- 1400 — Flyer workers.
--   flyer_workers          people paid to hand out flyers. No sign-in (no auth user, no profile), never
--                          scheduled. `code` is printed on their flyer and is their QR link (/f/<code>).
--   flyer_batches          flyers handed to a worker. Pay = flyer_count × rate (rate defaults from the
--                          worker and can be changed per batch); paid_at is set when the owner pays it.
--   flyer_scans            one row per QR scan. visitor = hash of ip + user agent, for unique-scan counts.
--   leads.flyer_worker_id  whose flyer brought the lead in (QR link, or set by the owner for phone-ins).
-- Owner-only like every ops table: crew and anon see none of it.
-- =============================================================================

create table public.flyer_workers (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  name            text not null,
  phone           text,
  code            text not null unique,
  rate_per_flyer  numeric(6,3) not null default 0.10,
  removed_at      timestamptz,
  constraint flyer_workers_name check (length(trim(name)) > 0),
  constraint flyer_workers_code check (code ~ '^[A-Z0-9]{4,8}$'),
  constraint flyer_workers_rate check (rate_per_flyer >= 0 and rate_per_flyer <= 100)
);

create table public.flyer_batches (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  flyer_worker_id  uuid not null references public.flyer_workers (id) on delete restrict,
  handed_out_on    date not null default current_date,
  flyer_count      integer not null,
  rate             numeric(6,3) not null,
  amount           numeric(12,2) generated always as (round(flyer_count * rate, 2)) stored not null,
  area             text,
  paid_at          timestamptz,
  constraint flyer_batches_count check (flyer_count > 0 and flyer_count <= 100000),
  constraint flyer_batches_rate  check (rate >= 0 and rate <= 100)
);
create index flyer_batches_worker_idx on public.flyer_batches (flyer_worker_id, handed_out_on);
create index flyer_batches_unpaid_idx on public.flyer_batches (flyer_worker_id) where paid_at is null;

create table public.flyer_scans (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  flyer_worker_id  uuid not null references public.flyer_workers (id) on delete cascade,
  visitor          text not null
);
create index flyer_scans_worker_idx on public.flyer_scans (flyer_worker_id, visitor);

alter table public.leads
  add column flyer_worker_id uuid references public.flyer_workers (id) on delete set null;
create index leads_flyer_worker_idx on public.leads (flyer_worker_id) where flyer_worker_id is not null;

-- updated_at trigger, RLS (owner only) and no anon privileges, as in 0200 / 0500.
do $$
declare
  t text;
begin
  foreach t in array array['flyer_workers', 'flyer_batches', 'flyer_scans'] loop
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

comment on table public.flyer_workers is
  'People paid per flyer handed out. No sign-in. code is printed on their flyer and is their QR link (/f/<code>).';
comment on column public.flyer_batches.rate is
  'Pay per flyer for this batch (defaults from flyer_workers.rate_per_flyer when logged).';
comment on column public.flyer_batches.paid_at is 'When the owner paid this batch out. Null = owed.';
comment on column public.flyer_scans.visitor is 'sha256 of ip + user agent (truncated): counts unique scanners without storing the ip.';
comment on column public.leads.flyer_worker_id is
  'Flyer worker whose flyer brought this lead in: from the QR link (/f/<code>) or set by the owner.';
