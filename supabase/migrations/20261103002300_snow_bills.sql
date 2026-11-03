-- Snow monthly bills: one row per customer per month once you set how they pay or mark it paid.
-- `amount` / `pushes` are what the month came to when the row was last saved (frozen once paid).
-- `snow_customers.pay_method` is how they usually pay, so the next month starts with it.
alter table public.snow_customers
  add column if not exists pay_method text,
  add constraint snow_customers_pay_method check (pay_method is null or pay_method in ('cash', 'card', 'check'));

create table public.snow_bills (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  snow_customer_id  uuid not null references public.snow_customers (id) on delete cascade,
  month             date not null,
  amount            numeric(10,2) not null default 0,
  pushes            integer not null default 0,
  pay_method        text,
  paid_at           timestamptz,
  constraint snow_bills_month      check (extract(day from month) = 1),
  constraint snow_bills_pay_method check (pay_method is null or pay_method in ('cash', 'card', 'check')),
  constraint snow_bills_amount     check (amount >= 0),
  unique (snow_customer_id, month)
);
create index snow_bills_month_idx on public.snow_bills (month);

create trigger set_updated_at before update on public.snow_bills for each row execute function public.set_updated_at();
alter table public.snow_bills enable row level security;
create policy owner_all on public.snow_bills for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.snow_bills from anon;
