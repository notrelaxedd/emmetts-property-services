-- =============================================================================
-- 20261111000100 — Door-to-door sales reps and their commission.
--   sales_reps          reps the owner adds under Employees → Sales reps. No sign-in. /door shows them
--                       as a dropdown, so every booking is tied to one rep (no spelling mix-ups).
--   leads.sales_rep_id  the rep who booked the lead on /door. leads.door_rep keeps their name as text.
--   commission_payouts  one row per job whose commission the owner has paid. No row = not paid.
--                       rate / job_amount / amount are copied at payout time, so a later rate or price
--                       change never rewrites what was paid. job_id goes null if the job is deleted;
--                       customer_label keeps the record readable.
-- Owner-only like every ops table.
-- =============================================================================

create table public.sales_reps (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  name             text not null,
  phone            text,
  commission_rate  numeric(4,3) not null default 0.20,
  removed_at       timestamptz,
  constraint sales_reps_name check (length(trim(name)) between 1 and 60),
  constraint sales_reps_rate check (commission_rate >= 0 and commission_rate <= 1)
);

alter table public.leads
  add column sales_rep_id uuid references public.sales_reps (id) on delete set null;
create index leads_sales_rep_idx on public.leads (sales_rep_id) where sales_rep_id is not null;

create table public.commission_payouts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sales_rep_id    uuid not null references public.sales_reps (id) on delete restrict,
  job_id          uuid unique references public.jobs (id) on delete set null,
  customer_label  text not null default '',
  rate            numeric(4,3) not null,
  job_amount      numeric(12,2) not null,
  amount          numeric(12,2) not null,
  method          text not null default 'cash',
  note            text,
  paid_at         timestamptz not null default now(),
  constraint commission_payouts_rate   check (rate >= 0 and rate <= 1),
  constraint commission_payouts_amount check (amount >= 0 and job_amount >= 0),
  constraint commission_payouts_method check (method in ('cash', 'venmo', 'zelle', 'check', 'other'))
);
create index commission_payouts_rep_idx on public.commission_payouts (sales_rep_id, paid_at);

-- updated_at trigger, RLS (owner only) and no anon privileges, as in 0200 / 0500.
do $$
declare
  t text;
begin
  foreach t in array array['sales_reps', 'commission_payouts'] loop
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

-- Reps who already booked on /door (typed names): one rep per name, ignoring case and spaces.
insert into public.sales_reps (name)
select distinct on (lower(trim(door_rep))) trim(door_rep)
from public.leads
where door_rep is not null and length(trim(door_rep)) > 0
order by lower(trim(door_rep)), created_at;

update public.leads l
set sales_rep_id = r.id
from public.sales_reps r
where l.door_rep is not null and lower(trim(l.door_rep)) = lower(trim(r.name)) and l.sales_rep_id is null;

comment on table public.sales_reps is
  'Door-to-door sales reps (no sign-in). Picked from a dropdown on /door. Paid commission_rate × job price.';
comment on column public.leads.sales_rep_id is 'Sales rep who booked this lead on /door.';
comment on table public.commission_payouts is
  'Commission paid to a sales rep for one job. No row for a job = not paid yet.';
