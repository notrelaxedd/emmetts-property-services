-- =============================================================================
-- 0900 — Scheduler fixes
--
--   jobs.resolve_reason ..... durable "re-look at this job" mark. Set by the
--                             places that used to pass `job_ids` in a schedule
--                             task payload (drop, decline, time off, weather
--                             hold); the scheduler picks up every marked job on
--                             its next run and clears the mark. Payload-borne
--                             ids were lost whenever the enqueue was de-duped
--                             against an earlier (even finished) task.
--   jobs.owner_hold ......... the owner decided about this job (rejected the
--                             proposed slot, or marked a "can't schedule" /
--                             "no cover" card handled): the scheduler leaves it
--                             alone until the owner releases it.
--   jobs.weather_hold_date .. the local day a weather-held job was taken off,
--                             kept closed on later sweeps until it is re-placed.
--   jobs_quote_id_key ....... at most one job per quote (double-job guard for
--                             webhook retries racing each other).
--   crew_jobs ............... only jobs the crew member is still on (offered,
--                             accepted, swap offered, drop requested), and no
--                             unpriced custom-request text in `services`.
-- =============================================================================

alter table public.jobs
  add column resolve_reason    text,
  add column owner_hold        boolean not null default false,
  add column weather_hold_date date;

comment on column public.jobs.resolve_reason is
  'Why the scheduler should re-look at this job on its next run (drop, declined, crew_change, weather_hold); cleared by the scheduler.';
comment on column public.jobs.owner_hold is
  'Owner decision stands: the scheduler does not propose, reset or find cover for this job until released.';
comment on column public.jobs.weather_hold_date is
  'Local date a weather-held job was taken off; kept closed for re-planning until the job is re-proposed.';

create index if not exists jobs_resolve_idx on public.jobs (resolve_reason) where resolve_reason is not null;

create unique index if not exists jobs_quote_id_key on public.jobs (quote_id) where quote_id is not null;

-- -----------------------------------------------------------------------------
-- crew_jobs: same columns and rights as 0400, tighter rows.
-- -----------------------------------------------------------------------------
create or replace view public.crew_jobs
with (security_invoker = false, security_barrier = true)
as
select
  j.id,
  j.status,
  j.start_at,
  j.end_at,
  j.est_minutes,
  j.crew_size,
  j.weather_hold,
  c.name     as customer_name,
  c.address,
  c.lat,
  c.lng,
  coalesce(
    (
      select array_agg(coalesce(s.name, qi.description) order by qi.sort_order, qi.created_at)
      from public.quote_items qi
      left join public.services s on s.id = qi.service_id
      where j.quote_id is not null
        and qi.quote_id = j.quote_id
        and qi.status not in ('declined', 'referred', 'needs_owner')
    ),
    '{}'::text[]
  )          as services,
  j.notes,
  j.actual_minutes,
  j.started_at,
  j.completed_at
from public.jobs j
join public.customers c on c.id = j.customer_id
where public.is_owner()
   or auth.role() = 'service_role'
   or exists (
        select 1
        from public.job_assignments ja
        where ja.job_id = j.id
          and ja.crew_id = public.current_profile_id()
          and ja.status in ('offered', 'accepted', 'swap_offered', 'drop_requested')
      );

comment on view public.crew_jobs is
  'Crew-safe jobs: no prices or customer contact details. Owner sees all; crew see jobs they are still on (offered, accepted, swap offered, drop requested).';

revoke all on public.crew_jobs from public, anon, authenticated;
grant select on public.crew_jobs to authenticated, service_role;
