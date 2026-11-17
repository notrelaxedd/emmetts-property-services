-- =============================================================================
-- 20261117000100 — Keep every quote-form submission, even ones that never become a lead.
--   quote_submissions  one row per press of Submit on /quote, written before anything else can fail
--                      (validation, rate limit, the database, a crashed request). `outcome` starts as
--                      'received' and moves to 'saved' (lead_id set), 'rejected' (reason = what the
--                      customer was told) or 'failed' (reason = the server error). A row left at
--                      'received' means the request died part way. /admin/leads lists the ones that
--                      didn't become a lead so nobody who reached out is lost. client_key is a random
--                      id the browser sends with each press, so its retry through /api/quote (after a
--                      failed action) never makes a second lead.
-- Owner-only like every ops table. Only the service role (the quote action) writes it.
-- =============================================================================

create table public.quote_submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  via         text not null default 'action',
  client_key  uuid unique,
  outcome     text not null default 'received',
  reason      text,
  name        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  address     text not null default '',
  form        jsonb not null default '{}'::jsonb,
  lead_id     uuid references public.leads (id) on delete set null,
  dismissed_at timestamptz,
  constraint quote_submissions_via check (via in ('action', 'api')),
  constraint quote_submissions_outcome check (outcome in ('received', 'saved', 'rejected', 'failed'))
);
create index quote_submissions_open_idx on public.quote_submissions (created_at desc)
  where outcome <> 'saved' and dismissed_at is null;

create trigger set_updated_at before update on public.quote_submissions
  for each row execute function public.set_updated_at();
alter table public.quote_submissions enable row level security;
create policy owner_all on public.quote_submissions for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.quote_submissions from anon;

comment on table public.quote_submissions is
  'Every /quote submit, saved first. outcome: received → saved (lead_id) / rejected / failed.';
