-- =============================================================================
-- 20261116000200 — Edit a finished job's profit.
--   jobs.profit_override  the owner's own profit figure for a done job (null = worked out: price − card
--                         fee − labor). On the Money page the job's labor becomes price − fee − override,
--                         so the month and week totals follow the edited number.
-- Owner-only like the rest of jobs (RLS in 0500); the crew_jobs view doesn't select it.
-- =============================================================================

alter table public.jobs
  add column if not exists profit_override numeric(12,2);

comment on column public.jobs.profit_override is
  'Owner-set profit for a done job; null = price − fee − labor.';
