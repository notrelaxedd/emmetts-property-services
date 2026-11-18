-- =============================================================================
-- 20261118000100 — Owners doing the job themselves.
--   jobs.owners_working  true when the owners (Caden / Emmett) do the work: no crew pay comes out of
--                        the job, so the calendar and the Money page count it as pure take-home (minus
--                        a card fee when the customer pays by card). Crew pay actually recorded for the
--                        job (payouts) still counts.
-- Owner-only like the rest of jobs (RLS in 0500); the crew_jobs view doesn't select it.
-- =============================================================================

alter table public.jobs
  add column if not exists owners_working boolean not null default false;

comment on column public.jobs.owners_working is
  'Owners do the work: no estimated crew pay; take-home = price − card fee − recorded payouts.';
