-- =============================================================================
-- 20261117000200 — Who is posting server actions to the public pages.
--   action_requests       one row per server-action POST to a public page (/quote, /door, ...), written
--                         by middleware.ts BEFORE Next.js looks the action up. A request Next.js then
--                         rejects ("Failed to find Server Action": a bot, or a page from an older
--                         deployment) never reaches our code, so this is the only record of it: IP,
--                         browser, rough location (Vercel's geo headers), page and the action id it sent.
--   quote_submissions.ip / user_agent
--                         the same details on every real quote submission, so a logged request
--                         with no submission from that IP around that time is one that was turned away.
--   unmatched_quote_action_requests
--                         those turned-away /quote requests: no quote submission from the same IP
--                         within 2 minutes.
-- Owner-only like every ops table. Only the service role writes these.
-- =============================================================================

create table public.action_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  path        text not null default '',
  action_id   text not null default '',
  ip          text,
  user_agent  text,
  referer     text,
  country     text,
  region      text,
  city        text
);
create index action_requests_created_idx on public.action_requests (created_at desc);
create index action_requests_ip_idx on public.action_requests (ip, created_at);

create trigger set_updated_at before update on public.action_requests
  for each row execute function public.set_updated_at();
alter table public.action_requests enable row level security;
create policy owner_all on public.action_requests for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on public.action_requests from anon;

alter table public.quote_submissions
  add column if not exists ip text,
  add column if not exists user_agent text;
create index if not exists quote_submissions_ip_idx on public.quote_submissions (ip, created_at);

create view public.unmatched_quote_action_requests
  with (security_invoker = true) as
select r.*
from public.action_requests r
where r.path = '/quote'
  and not exists (
    select 1 from public.quote_submissions s
    where s.ip = r.ip
      and s.created_at between r.created_at - interval '2 minutes' and r.created_at + interval '2 minutes'
  );
revoke all on public.unmatched_quote_action_requests from anon;

comment on table public.action_requests is
  'Server-action POSTs to public pages, logged by middleware before Next.js resolves the action (catches rejected ones).';
comment on view public.unmatched_quote_action_requests is
  '/quote action requests with no quote submission from the same IP within 2 minutes: turned away before our code ran.';
