-- =============================================================================
-- 0500 — Row-level security
--
-- Owner (profiles.role = 'owner'): full access to every table.
-- Crew:
--   profiles ............ read own row; update own row (profiles_guard limits
--                         the columns to name / phone / max_hours_week / paused)
--   crew_availability ... read / insert / update / delete own rows
--   crew_exceptions ..... read / insert / update / delete own rows
--                         (crew_exceptions_guard forces status = pending)
--   job_assignments ..... read own rows; update own rows (job_assignments_guard
--                         limits it to status / responded_at)
--   payouts ............. read own rows
--   services ............ read
--   crew_jobs (view) .... read (filtered inside the view)
--   everything else ..... nothing
-- Anonymous: nothing (and table privileges are revoked as a second wall).
--   The public quote form writes through a server action using the service role.
-- Service role: bypasses RLS (Supabase default).
--
-- Helper calls are wrapped in (select ...) so Postgres evaluates them once per
-- statement instead of once per row.
-- =============================================================================

-- Enable RLS + owner-full-access policy on every table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'profiles', 'services', 'customers', 'leads', 'quotes', 'quote_items',
    'jobs', 'job_assignments', 'owner_windows', 'owner_exceptions', 'crew_availability',
    'crew_exceptions', 'approvals', 'ads', 'messages', 'payouts', 'expenses', 'ai_usage',
    'fleet_workers', 'fleet_tasks', 'stripe_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using ((select public.is_owner())) with check ((select public.is_owner()))', t);
    -- Anonymous users get no table privileges at all.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- profiles --------------------------------------------------------------------
create policy crew_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy crew_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- services --------------------------------------------------------------------
create policy crew_select on public.services
  for select to authenticated
  using (true);

-- crew_availability -----------------------------------------------------------
create policy crew_select_own on public.crew_availability
  for select to authenticated
  using (crew_id = (select public.current_profile_id()));
create policy crew_insert_own on public.crew_availability
  for insert to authenticated
  with check (crew_id = (select public.current_profile_id()));
create policy crew_update_own on public.crew_availability
  for update to authenticated
  using (crew_id = (select public.current_profile_id()))
  with check (crew_id = (select public.current_profile_id()));
create policy crew_delete_own on public.crew_availability
  for delete to authenticated
  using (crew_id = (select public.current_profile_id()));

-- crew_exceptions -------------------------------------------------------------
create policy crew_select_own on public.crew_exceptions
  for select to authenticated
  using (crew_id = (select public.current_profile_id()));
create policy crew_insert_own on public.crew_exceptions
  for insert to authenticated
  with check (crew_id = (select public.current_profile_id()));
create policy crew_update_own on public.crew_exceptions
  for update to authenticated
  using (crew_id = (select public.current_profile_id()))
  with check (crew_id = (select public.current_profile_id()));
create policy crew_delete_own on public.crew_exceptions
  for delete to authenticated
  using (crew_id = (select public.current_profile_id()));

-- job_assignments -------------------------------------------------------------
create policy crew_select_own on public.job_assignments
  for select to authenticated
  using (crew_id = (select public.current_profile_id()));
create policy crew_update_own on public.job_assignments
  for update to authenticated
  using (crew_id = (select public.current_profile_id()))
  with check (crew_id = (select public.current_profile_id()));

-- payouts ---------------------------------------------------------------------
create policy crew_select_own on public.payouts
  for select to authenticated
  using (crew_id = (select public.current_profile_id()));

-- No crew policies on: settings, customers, leads, quotes, quote_items, jobs,
-- owner_windows, owner_exceptions, approvals, ads, messages, expenses, ai_usage,
-- fleet_workers, fleet_tasks, stripe_events. Crew read jobs only via crew_jobs.
