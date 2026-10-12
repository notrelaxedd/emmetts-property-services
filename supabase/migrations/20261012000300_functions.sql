-- =============================================================================
-- 0300 — Functions and triggers
--
--   Role helpers ......... current_role(), is_owner(), current_profile_id()
--   AI budget ............ ai_spend_this_month()
--   Task queue ........... enqueue_task(), claim_task(), complete_task(),
--                          fail_task(), requeue_stale_tasks()
--   Guard triggers ....... profiles / crew_exceptions / job_assignments / settings
--   Auth hook ............ handle_new_user() on auth.users insert
--
-- "Trusted" callers: the service role (fleet workers, server actions), the
-- postgres role (SQL editor / migrations) and any SECURITY DEFINER function.
-- "Untrusted" callers are the PostgREST roles `anon` and `authenticated`
-- (except an owner, who is trusted for everything).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so they can read profiles regardless of RLS,
-- which also avoids infinite recursion when profiles' own policies call them).
-- -----------------------------------------------------------------------------

-- The caller's role from profiles, or null (anon / service role / no profile).
-- `current_role` is an SQL keyword, so the name is quoted at definition time.
-- Call it as `public.current_role()` in SQL, or `rpc('current_role')` from supabase-js.
create or replace function public."current_role"()
returns public.role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.user_id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'owner'
  )
$$;

-- profiles.id of the caller (crew_id in crew tables), or null.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.user_id = auth.uid()
$$;

-- True when the current statement comes from an untrusted API role that is not
-- the owner. SECURITY INVOKER on purpose: it must see the *calling* role.
create or replace function public.is_untrusted_caller()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user in ('anon', 'authenticated') and not public.is_owner()
$$;

-- -----------------------------------------------------------------------------
-- ai_spend_this_month() — sum of ai_usage.est_cost for the current calendar
-- month in the business timezone (America/New_York, see lib/site-config.ts).
-- Owner / service role only.
-- -----------------------------------------------------------------------------
create or replace function public.ai_spend_this_month()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  month_start timestamptz :=
    date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York';
  total numeric;
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'ai_spend_this_month: owner only' using errcode = '42501';
  end if;
  select coalesce(sum(u.est_cost), 0) into total
  from public.ai_usage u
  where u.created_at >= month_start;
  return total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Task queue
-- -----------------------------------------------------------------------------

-- Enqueue a task. Idempotent on p_dedupe_key: if a task with that key already
-- exists (any status), its id is returned and nothing is inserted.
-- Callable by the service role and the owner.
create or replace function public.enqueue_task(
  p_type        public.fleet_task_type,
  p_role        public.fleet_role,
  p_payload     jsonb,
  p_run_after   timestamptz default now(),
  p_dedupe_key  text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'enqueue_task: owner or service role only' using errcode = '42501';
  end if;

  insert into public.fleet_tasks (type, role, payload, run_after, dedupe_key)
  values (p_type, p_role, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_after, now()), p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select t.id into v_id from public.fleet_tasks t where t.dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

-- Atomically claim the oldest runnable task for a worker role. Returns zero or
-- one row. Concurrent callers never get the same task (FOR UPDATE SKIP LOCKED).
create or replace function public.claim_task(p_role public.fleet_role, p_worker text)
returns setof public.fleet_tasks
language sql
volatile
security definer
set search_path = public
as $$
  with next_task as (
    select t.id
    from public.fleet_tasks t
    where t.status = 'queued'
      and t.role = p_role
      and t.run_after <= now()
      and t.attempts < t.max_attempts
    order by t.created_at, t.id
    limit 1
    for update skip locked
  )
  update public.fleet_tasks t
     set status      = 'running',
         worker      = p_worker,
         started_at  = now(),
         finished_at = null,
         attempts    = t.attempts + 1
    from next_task
   where t.id = next_task.id
  returning t.*
$$;

-- Mark a running task done with its result.
create or replace function public.complete_task(p_id uuid, p_result jsonb default null)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.fleet_tasks
     set status = 'done', result = p_result, error = null, finished_at = now()
   where id = p_id
$$;

-- Record a failure. Requeues with backoff until max_attempts is reached, then
-- marks the task failed. Backoff = p_retry_in if given, otherwise
-- 30s * 2^(attempts-1) (30s, 1m, 2m, 4m, ...). Returns the task's new status.
create or replace function public.fail_task(p_id uuid, p_error text, p_retry_in interval default null)
returns public.fleet_task_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status public.fleet_task_status;
begin
  update public.fleet_tasks t
     set error = p_error,
         status = case when t.attempts >= t.max_attempts then 'failed'::public.fleet_task_status
                       else 'queued'::public.fleet_task_status end,
         finished_at = case when t.attempts >= t.max_attempts then now() else null end,
         run_after = case when t.attempts >= t.max_attempts then t.run_after
                          else now() + coalesce(p_retry_in,
                                 interval '30 seconds' * power(2, greatest(t.attempts - 1, 0))) end
   where t.id = p_id
  returning t.status into v_status;
  return v_status;
end;
$$;

-- For the host worker: running tasks whose worker went quiet for p_stale are
-- requeued (or failed if out of attempts). Returns how many rows changed.
create or replace function public.requeue_stale_tasks(p_stale interval default interval '15 minutes')
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.fleet_tasks t
     set status = case when t.attempts >= t.max_attempts then 'failed'::public.fleet_task_status
                       else 'queued'::public.fleet_task_status end,
         error = coalesce(t.error || E'\n', '') || 'stale: no result from ' || coalesce(t.worker, '?')
                 || ' after ' || p_stale::text,
         finished_at = case when t.attempts >= t.max_attempts then now() else null end,
         run_after = now()
   where t.status = 'running'
     and t.started_at < now() - p_stale;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges. Supabase's default privileges grant EXECUTE to PUBLIC,
-- anon and authenticated; lock the queue down to the service role, and keep
-- the read helpers (current_role, is_owner, current_profile_id) available.
-- -----------------------------------------------------------------------------
revoke execute on function public.claim_task(public.fleet_role, text)              from public, anon, authenticated;
revoke execute on function public.complete_task(uuid, jsonb)                       from public, anon, authenticated;
revoke execute on function public.fail_task(uuid, text, interval)                  from public, anon, authenticated;
revoke execute on function public.requeue_stale_tasks(interval)                    from public, anon, authenticated;
revoke execute on function public.enqueue_task(public.fleet_task_type, public.fleet_role, jsonb, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.ai_spend_this_month()                            from public, anon, authenticated;

grant execute on function public.claim_task(public.fleet_role, text)               to service_role;
grant execute on function public.complete_task(uuid, jsonb)                        to service_role;
grant execute on function public.fail_task(uuid, text, interval)                   to service_role;
grant execute on function public.requeue_stale_tasks(interval)                     to service_role;
-- enqueue_task / ai_spend_this_month check is_owner() internally for signed-in users.
grant execute on function public.enqueue_task(public.fleet_task_type, public.fleet_role, jsonb, timestamptz, text) to authenticated, service_role;
grant execute on function public.ai_spend_this_month()                             to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guard triggers
-- -----------------------------------------------------------------------------

-- profiles: default hourly_rate from settings; crew may only change
-- name / phone / max_hours_week / paused on their own row.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.hourly_rate is null then
      select s.default_wage into new.hourly_rate from public.settings s limit 1;
      new.hourly_rate := coalesce(new.hourly_rate, 15);
    end if;
    return new;
  end if;

  if public.is_untrusted_caller() then
    if new.user_id     is distinct from old.user_id
    or new.role        is distinct from old.role
    or new.hourly_rate is distinct from old.hourly_rate
    or new.email       is distinct from old.email
    or new.lat         is distinct from old.lat
    or new.lng         is distinct from old.lng
    or new.id          is distinct from old.id
    or new.created_at  is distinct from old.created_at then
      raise exception 'crew may only change name, phone, max_hours_week and paused'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- crew_exceptions: anything a crew member writes is (re)set to pending; only
-- the owner / service role can approve or decline.
create or replace function public.crew_exceptions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_untrusted_caller() then
    new.status := 'pending';
  end if;
  return new;
end;
$$;

create trigger crew_exceptions_guard
  before insert or update on public.crew_exceptions
  for each row execute function public.crew_exceptions_guard();

-- job_assignments: crew may only change status (to a response value) and
-- responded_at on their own rows (row ownership is enforced by RLS).
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
    or new.created_at      is distinct from old.created_at then
      raise exception 'crew may only change status and responded_at'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('accepted', 'declined', 'swap_offered', 'drop_requested') then
      raise exception 'crew cannot set assignment status to %', new.status
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger job_assignments_guard
  before update on public.job_assignments
  for each row execute function public.job_assignments_guard();

-- settings: the single row can't be deleted (a second row is already
-- impossible thanks to the settings_singleton check on the primary key).
create or replace function public.settings_no_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'the settings row cannot be deleted';
end;
$$;

create trigger settings_no_delete
  before delete on public.settings
  for each row execute function public.settings_no_delete();

-- -----------------------------------------------------------------------------
-- Auth hook: every new auth user gets a `crew` profile unless one exists.
-- The owner invites crew (magic link), so new users are crew by default. The
-- first owner is promoted by hand in SQL — see supabase/README.md.
-- Role is never read from user metadata (users can set their own metadata).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, role, name, email, phone)
  values (
    new.id,
    'crew',
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''),
             nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
             ''),
    new.email,
    new.phone
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
