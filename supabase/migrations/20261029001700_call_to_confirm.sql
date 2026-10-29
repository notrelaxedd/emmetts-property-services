-- =============================================================================
-- 1700 — Quote → calendar → crew availability → phone call → pay after the job.
--
-- The booking flow is now owner-driven:
--   1. the quotes worker estimates price / crew / hours and creates the job straight away
--      (`jobs.paid = false`, status `unscheduled`: the "Needs a day" rail on /admin/schedule);
--   2. the owner drags it onto the calendar → every crew member who could work that slot is
--      emailed an availability request (`job_assignments.respond_token` makes the Available /
--      Can't links in that email work without a login);
--   3. the owner calls the customer, confirms the quote and the day, and records how they will
--      pay (`quotes.payment_method`: card = Stripe link, cash, check), told to the customer as
--      "we collect once the job is done";
--   4. the money arrives after the job (`quotes.paid_at`).
--
--   quotes.paid_at ................ when the payment was received; null until then. `accepted` now
--                                   means "the customer said yes on the phone", not "paid".
--   quotes.payment_method ......... how the customer said they would pay (set at confirmation; the
--                                   payment that lands may still change it).
--   job_assignments.respond_token . unguessable id used in the crew availability email links.
--   job_assignments.notified_at ... when that email went out (null = not emailed).
--   settings.auto_schedule ........ false (default): the scheduler never places a new job by itself;
--                                   the owner drags it onto the calendar ("Run scheduler now" still
--                                   asks for suggestions). true: the old automatic placement.
-- =============================================================================

alter table public.quotes add column paid_at timestamptz;
-- Until now `accepted` was only ever set by a payment (Stripe webhook, or cash / check recorded).
update public.quotes set paid_at = coalesce(accepted_at, updated_at) where status = 'accepted';
create index quotes_unpaid_idx on public.quotes (status) where paid_at is null;

comment on column public.quotes.paid_at is
  'When the payment was received (Stripe webhook, or cash / check recorded by the owner). Null until then.';
comment on column public.quotes.payment_method is
  'How the customer said they would pay when the owner confirmed the quote by phone (stripe = card link, cash, check); updated if the payment that lands differs.';
comment on column public.quotes.accepted_at is
  'When the customer agreed to the quote (confirmed by phone, or paid). Payment itself is paid_at.';

alter table public.job_assignments
  add column respond_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column notified_at   timestamptz;
create unique index job_assignments_respond_token_key on public.job_assignments (respond_token);

comment on column public.job_assignments.respond_token is
  'Random token in the crew availability email (Available / Can''t make it links work without a login).';
comment on column public.job_assignments.notified_at is 'When the availability email for this offer went out.';

alter table public.settings add column auto_schedule boolean not null default false;
comment on column public.settings.auto_schedule is
  'When true the scheduler places new jobs by itself (old behaviour). Default false: the owner drags jobs onto the calendar.';

-- Crew may answer an offer (status / responded_at) but never touch the token or the email mark.
create or replace function public.job_assignments_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_untrusted_caller() then
    if new.id              is distinct from old.id
    or new.job_id          is distinct from old.job_id
    or new.crew_id         is distinct from old.crew_id
    or new.swap_to_crew_id is distinct from old.swap_to_crew_id
    or new.respond_token   is distinct from old.respond_token
    or new.notified_at     is distinct from old.notified_at
    or new.created_at      is distinct from old.created_at then
      raise exception 'crew may only change status and responded_at'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not (   (old.status = 'offered'  and new.status in ('accepted', 'declined'))
                or (old.status = 'accepted' and new.status = 'drop_requested')) then
      raise exception 'crew cannot change assignment status from % to %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
