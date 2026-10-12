-- =============================================================================
-- 0400 — crew_jobs view
--
-- Crew-safe projection of jobs: time, place, services and notes only — no
-- prices, no customer phone/email. Columns match `Views.crew_jobs.Row` in
-- lib/db/types.ts.
--
-- The view runs with its owner's rights (security_invoker = false) so it can
-- read jobs/customers/quote_items, which crew cannot select directly. Row
-- filtering is done inside the view: the owner sees every job, a crew member
-- sees only jobs they have an assignment on, the service role sees all, and
-- everyone else (anon) sees nothing.
-- security_barrier stops caller-supplied predicates from being evaluated
-- before that filter (no leaking rows through side-effecting functions).
-- =============================================================================

create view public.crew_jobs
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
        and qi.status not in ('declined', 'referred')
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
      );

comment on view public.crew_jobs is
  'Crew-safe jobs: no prices or customer contact details. Owner sees all; crew see jobs they are assigned to.';

revoke all on public.crew_jobs from public, anon, authenticated;
grant select on public.crew_jobs to authenticated, service_role;
