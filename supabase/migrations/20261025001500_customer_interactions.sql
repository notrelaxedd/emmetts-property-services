-- =============================================================================
-- 1500 — Customer interactions (the price log).
--   customer_interactions  one row per conversation the owner logs by hand: phone call, a chat at the
--                          door, a text. What it was about (category, free text: "Leaves", "Snow plowing"),
--                          the price the owner gave, and an optional follow-up date, so the next person
--                          who talks to the customer quotes the same number.
--   status                 open (waiting on the customer), booked (they said yes), passed (they said no).
-- Owner-only like every ops table: crew and anon see none of it.
-- =============================================================================

create table public.customer_interactions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  talked_on     date not null default current_date,
  category      text not null,
  price         numeric(10,2),
  notes         text,
  follow_up_on  date,
  status        text not null default 'open',
  constraint customer_interactions_category check (length(trim(category)) > 0),
  constraint customer_interactions_price    check (price is null or price >= 0),
  constraint customer_interactions_status   check (status in ('open', 'booked', 'passed'))
);
create index customer_interactions_customer_idx on public.customer_interactions (customer_id, talked_on desc);
create index customer_interactions_follow_up_idx on public.customer_interactions (follow_up_on) where status = 'open';

-- updated_at trigger, RLS (owner only) and no anon privileges, as in 0200 / 0500.
create trigger set_updated_at before update on public.customer_interactions
  for each row execute function public.set_updated_at();
alter table public.customer_interactions enable row level security;
create policy owner_all on public.customer_interactions for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.customer_interactions from anon;

comment on table public.customer_interactions is
  'Conversations the owner logged by hand (price log): what was discussed, the price given, when to follow up.';
comment on column public.customer_interactions.category is 'What the conversation was about, e.g. Leaves, Snow plowing. Free text.';
comment on column public.customer_interactions.price is 'The price the owner gave, in dollars. Null when no price came up.';
comment on column public.customer_interactions.status is 'open (waiting on the customer), booked (said yes) or passed (said no).';
