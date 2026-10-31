-- =============================================================================
-- Database tests: RLS, guard triggers, queue functions, constraints.
-- Run by supabase/test/run.sh against a fresh database (shim + migrations).
--
-- Each check prints "ok - ..." or "NOT OK - ..." and is recorded in
-- tests.results; the final block raises (non-zero exit) if anything failed.
-- Users are simulated with `set role` + request.jwt.claims, as PostgREST does.
-- =============================================================================
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- Test helpers (schema `tests`, usable by every API role)
-- ---------------------------------------------------------------------------
create schema tests;
create table tests.results (n serial primary key, ok boolean not null, description text not null, detail text);
create table tests.fx (key text primary key, id uuid not null);   -- fixture ids

create function tests.check(p_ok boolean, p_description text, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into tests.results (ok, description, detail) values (coalesce(p_ok, false), p_description, p_detail);
  if coalesce(p_ok, false) then
    raise notice 'ok - %', p_description;
  else
    raise notice 'NOT OK - % %', p_description, coalesce('(' || p_detail || ')', '');
  end if;
end $$;

-- Row count of a query, or -1 when the role lacks privileges.
create function tests.count_rows(p_query text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', p_query) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;

-- Run a statement. Returns 'ok:<rows affected>' or 'err:<sqlstate>:<message>'.
create function tests.run(p_sql text)
returns text language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

create function tests.id(p_key text) returns uuid language sql stable as $$
  select id from tests.fx where key = p_key
$$;

-- Simulate a signed-in user (or anon when p_uid is null).
create function tests.claims(p_uid uuid, p_role text default 'authenticated') returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', p_role)::text, false);
$$;

grant usage on schema tests to anon, authenticated, service_role;
grant all on all tables in schema tests to anon, authenticated, service_role;
grant all on all sequences in schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, i.e. a trusted caller)
-- ---------------------------------------------------------------------------
\echo '# fixtures'
-- Real Supabase auth.users columns the auth hook keys off (0800_guards); the
-- local shim doesn't have them.
alter table auth.users
  add column if not exists invited_at         timestamptz,
  add column if not exists phone_confirmed_at timestamptz;

-- Owner-invited users (invited_at set), so the auth hook creates their profiles.
insert into auth.users (id, email, raw_user_meta_data, invited_at) values
  ('00000000-0000-0000-0000-0000000000a0', 'owner@example.com', '{"name":"Emmett"}', now()),
  ('00000000-0000-0000-0000-0000000000a1', 'crewa@example.com', '{"name":"Crew A"}', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'crewb@example.com', '{}', now());

-- First owner is promoted by hand (README).
update public.profiles set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a0';

insert into tests.fx select 'owner_uid', '00000000-0000-0000-0000-0000000000a0';
insert into tests.fx select 'crew_a_uid', '00000000-0000-0000-0000-0000000000a1';
insert into tests.fx select 'crew_b_uid', '00000000-0000-0000-0000-0000000000b1';
insert into tests.fx select 'owner', id from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a0';
insert into tests.fx select 'crew_a', id from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into tests.fx select 'crew_b', id from public.profiles where user_id = '00000000-0000-0000-0000-0000000000b1';

with c as (
  insert into public.customers (name, email, phone, address, lat, lng, lot_acres, tree_cover)
  values ('Pat Homeowner', 'pat@example.com', '440-555-0100', '1 Lake Rd, Rocky River, OH', 41.48, -81.84, 0.25, 'medium')
  returning id
) insert into tests.fx select 'customer', id from c;

with l as (
  insert into public.leads (customer_id, source, requested_service_ids, custom_request, preferred_days)
  select tests.id('customer'), 'web', array_agg(id), 'Brush pile by the garage', '{1,3}'
  from public.services where slug in ('leaf-removal', 'gutter-cleaning')
  returning id
) insert into tests.fx select 'lead', id from l;

with q as (
  insert into public.quotes (lead_id, customer_id, status, price_total, labor_total, fee_total, profit_total)
  values (tests.id('lead'), tests.id('customer'), 'accepted', 240, 120, 7.26, 112.74)
  returning id
) insert into tests.fx select 'quote', id from q;

insert into public.quote_items (quote_id, service_id, description, is_custom, crew_size, est_hours, price, status, sort_order)
select tests.id('quote'), s.id, s.name, false, 2, 1.5, 90, 'auto', s.sort_order
from public.services s where s.slug in ('leaf-removal', 'gutter-cleaning');
insert into public.quote_items (quote_id, description, is_custom, crew_size, est_hours, price, status, sort_order)
values (tests.id('quote'), 'Haul brush pile', true, 2, 1, 60, 'priced', 99),
       (tests.id('quote'), 'Remove oak tree', true, 2, 0, null, 'referred', 100);

with j as (
  insert into public.jobs (quote_id, customer_id, status, est_minutes, crew_size, paid, notes, start_at, end_at)
  values (tests.id('quote'), tests.id('customer'), 'booked', 180, 2, true, 'Gate code 1234',
          '2026-10-20 13:00Z', '2026-10-20 16:00Z')
  returning id
) insert into tests.fx select 'job1', id from j;
with j as (
  insert into public.jobs (customer_id, status, est_minutes, crew_size, notes)
  values (tests.id('customer'), 'proposed', 60, 1, 'Crew B only')
  returning id
) insert into tests.fx select 'job2', id from j;

with a as (
  insert into public.job_assignments (job_id, crew_id, status) values (tests.id('job1'), tests.id('crew_a'), 'offered')
  returning id
) insert into tests.fx select 'assign_a', id from a;
with a as (
  insert into public.job_assignments (job_id, crew_id, status) values (tests.id('job2'), tests.id('crew_b'), 'offered')
  returning id
) insert into tests.fx select 'assign_b', id from a;

insert into public.payouts (crew_id, job_id, hours, rate, amount) values
  (tests.id('crew_a'), tests.id('job1'), 3, 15, 45),
  (tests.id('crew_b'), tests.id('job2'), 1, 15, 15);

with ca as (
  insert into public.crew_availability (crew_id, weekday, start_time, end_time)
  values (tests.id('crew_b'), 2, '08:00', '12:00') returning id
) insert into tests.fx select 'avail_b', id from ca;

insert into public.approvals (kind, ref_table, ref_id, title, created_by)
values ('quote', 'quotes', tests.id('quote'), 'Quote for Pat', 'w2-quotes');
insert into public.ads (channel, headline, body, utm_code) values ('nextdoor', 'Fall cleanup', 'Book now', 'nd-fall-1');
insert into public.messages (customer_id, channel, kind, body) values (tests.id('customer'), 'email', 'quote', 'Your quote');
insert into public.expenses (category, amount) values ('fuel', 40);
insert into public.ai_usage (task, model, est_cost, created_at) values
  ('draftAd', 'claude-sonnet-5-5', 0.50, now()),
  ('draftAd', 'claude-sonnet-5-5', 0.25, now()),
  ('draftAd', 'claude-sonnet-5-5', 9.00, now() - interval '62 days');
insert into public.fleet_workers (name, role) values ('w2', 'quotes');
insert into public.stripe_events (stripe_event_id, type) values ('evt_1', 'checkout.session.completed');
insert into public.owner_exceptions (date, closed) values ('2026-11-26', true);

-- 1400: a flyer worker with one batch, one scan, and the lead credited to them.
with w as (
  insert into public.flyer_workers (name, code) values ('Flyer Fran', 'K7M2') returning id
) insert into tests.fx select 'flyer_worker', id from w;
insert into public.flyer_batches (flyer_worker_id, flyer_count, rate) values (tests.id('flyer_worker'), 250, 0.125);
insert into public.flyer_scans (flyer_worker_id, visitor) values (tests.id('flyer_worker'), 'v1');
update public.leads set flyer_worker_id = tests.id('flyer_worker') where id = tests.id('lead');

-- 1500: one price-log entry for Pat.
insert into public.customer_interactions (customer_id, category, price, follow_up_on)
values (tests.id('customer'), 'Leaves', 185, '2026-11-01');

-- ---------------------------------------------------------------------------
\echo '# seed + auth hook'
-- ---------------------------------------------------------------------------
select tests.check((select count(*) from public.settings) = 1, 'settings has exactly one row');
select tests.check((select id from public.settings) = '00000000-0000-0000-0000-000000000001', 'settings row has the fixed id');
select tests.check(
  (select default_wage = 15 and margin = 0.50 and card_fee_pct = 0.029 and card_fee_fixed = 0.30
          and drop_notice_hours = 24 and quote_valid_days = 14
          and ai_monthly_cap is null and min_job_price is null
   from public.settings),
  'settings defaults match the plan');
select tests.check(
  (select autopilot = '{"ad":{"enabled":false},"quote":{"enabled":false,"max_total":null},"custom_item":{"enabled":false},"booking":{"enabled":false},"followup":{"enabled":false},"crew_change":{"enabled":false},"drop":{"enabled":false},"weather_hold":{"enabled":false}}'::jsonb
   from public.settings),
  'settings.autopilot defaults to everything off (matches DEFAULT_AUTOPILOT)');
select tests.check(
  (select array_agg(slug order by sort_order) from public.services)
    = array['fall-cleanup','leaf-removal','edging','gutter-cleaning','lawn-mowing','snow-removal'],
  'services seeded with the six slugs');
select tests.check((select bool_and(auto_quote) from public.services), 'all seeded services are auto_quote');
select tests.check(
  (select count(*) from public.owner_windows where start_time = '09:00' and end_time = '18:00') = 6
  and (select array_agg(weekday order by weekday) from public.owner_windows) = '{1,2,3,4,5,6}'::smallint[],
  'owner_windows seeded Mon-Sat 09:00-18:00');
select tests.check(
  (select count(*) from public.profiles where role = 'crew') = 2
  and (select name from public.profiles where user_id = tests.id('crew_a_uid')) = 'Crew A'
  and (select name from public.profiles where user_id = tests.id('crew_b_uid')) = 'crewb',
  'invited auth.users insert creates a crew profile (name from metadata or email)');
select tests.check(
  (select bool_and(hourly_rate = 15) from public.profiles),
  'profiles.hourly_rate defaults from settings.default_wage');
select tests.check(
  tests.run($$insert into public.profiles (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'dup')$$) like 'err:23505:%',
  'a second profile for the same user is rejected');

-- ---------------------------------------------------------------------------
\echo '# anon'
-- ---------------------------------------------------------------------------
select tests.claims(null, 'anon');
set role anon;

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'settings', 'profiles', 'services', 'customers', 'leads', 'quotes', 'quote_items',
    'jobs', 'job_assignments', 'owner_windows', 'owner_exceptions', 'crew_availability',
    'crew_exceptions', 'approvals', 'ads', 'messages', 'payouts', 'expenses', 'ai_usage',
    'fleet_workers', 'fleet_tasks', 'stripe_events', 'flyer_workers', 'flyer_batches', 'flyer_scans',
    'customer_interactions', 'crew_jobs'
  ] loop
    n := tests.count_rows(format('select * from public.%I', t));
    perform tests.check(n <= 0, format('anon reads nothing from %s', t),
                        case when n = -1 then 'permission denied' else n || ' rows' end);
  end loop;
end $$;

select tests.check(
  tests.run($$insert into public.customers (name) values ('Spammer')$$) like 'err:42501:%',
  'anon cannot insert customers');
select tests.check(
  tests.run($$insert into public.leads (customer_id) values ('00000000-0000-0000-0000-000000000000')$$) like 'err:42501:%',
  'anon cannot insert leads');
select tests.check(
  tests.run($$select public.enqueue_task('quote', 'quotes', '{}')$$) like 'err:42501:%',
  'anon cannot call enqueue_task');
select tests.check(
  tests.run($$select * from public.claim_task('quotes', 'evil')$$) like 'err:42501:%',
  'anon cannot call claim_task');
-- 1000: the role helpers are not exposed to anon at all.
select tests.check(
  tests.run($$select public.is_owner()$$) like 'err:42501:%'
  and tests.run($$select public.current_role()$$) like 'err:42501:%'
  and tests.run($$select public.current_profile_id()$$) like 'err:42501:%',
  'anon cannot call is_owner() / current_role() / current_profile_id()');

reset role;

-- ---------------------------------------------------------------------------
\echo '# crew A'
-- ---------------------------------------------------------------------------
select tests.claims(tests.id('crew_a_uid'));
set role authenticated;

select tests.check(public.current_role() = 'crew' and not public.is_owner(), 'crew: current_role() = crew, is_owner() = false');

-- crew_jobs: own assignment only, crew-safe columns.
select tests.check((select count(*) from public.crew_jobs) = 1, 'crew_jobs shows exactly the one assigned job');
select tests.check((select id from public.crew_jobs) = tests.id('job1'), 'crew_jobs row is the assigned job');
select tests.check(
  (select customer_name = 'Pat Homeowner' and address like '1 Lake Rd%' and lat = 41.48 and notes = 'Gate code 1234'
          and est_minutes = 180 and crew_size = 2 and status = 'booked'
   from public.crew_jobs),
  'crew_jobs exposes name/address/lat/notes/time fields');
select tests.check(
  (select services from public.crew_jobs) = array['Leaf Blowing & Removal', 'Gutter Cleaning', 'Haul brush pile'],
  'crew_jobs.services aggregates service names (+ priced custom items, minus referred)',
  (select services::text from public.crew_jobs));
select tests.check(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'crew_jobs')
  = array['id','status','start_at','end_at','est_minutes','crew_size','weather_hold','customer_name',
          'address','lat','lng','services','notes','actual_minutes','started_at','completed_at'],
  'crew_jobs has exactly the contract columns (no price/phone/email)');

-- Price / customer / ops tables: nothing.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'quotes', 'quote_items', 'customers', 'leads', 'settings', 'jobs', 'approvals', 'ads',
    'messages', 'expenses', 'ai_usage', 'fleet_workers', 'fleet_tasks', 'stripe_events',
    'owner_windows', 'owner_exceptions', 'flyer_workers', 'flyer_batches', 'flyer_scans', 'customer_interactions'
  ] loop
    n := tests.count_rows(format('select * from public.%I', t));
    perform tests.check(n <= 0, format('crew reads nothing from %s', t),
                        case when n = -1 then 'permission denied' else n || ' rows' end);
  end loop;
end $$;
select tests.check(
  tests.run($$update public.quotes set price_total = 1$$) = 'ok:0',
  'crew update on quotes touches 0 rows');
select tests.check(
  tests.run($$insert into public.jobs (customer_id) values ('00000000-0000-0000-0000-000000000000')$$) like 'err:42501:%',
  'crew cannot insert jobs');

-- profiles
select tests.check((select count(*) from public.profiles) = 1, 'crew sees only their own profile');
select tests.check(
  tests.run($$update public.profiles set name = 'Crew A.', phone = '440-555-0111', max_hours_week = 25, paused = true
              where user_id = auth.uid()$$) = 'ok:1',
  'crew can update own name/phone/max_hours_week/paused');
select tests.check(
  tests.run($$update public.profiles set role = 'owner' where user_id = auth.uid()$$) like 'err:42501:%',
  'crew cannot change own role');
select tests.check(
  tests.run($$update public.profiles set hourly_rate = 99 where user_id = auth.uid()$$) like 'err:42501:%',
  'crew cannot change own hourly_rate');
select tests.check(
  tests.run(format($$update public.profiles set name = 'hacked' where id = %L$$, tests.id('crew_b'))) = 'ok:0',
  'crew cannot update another profile');
select tests.check(
  tests.run($$insert into public.profiles (user_id, name, role) values ('00000000-0000-0000-0000-0000000000a1', 'x', 'owner')$$) like 'err:42501:%',
  'crew cannot insert profiles');
select tests.check(
  tests.run($$delete from public.profiles where user_id = auth.uid()$$) = 'ok:0',
  'crew cannot delete own profile');

-- crew_availability
select tests.check(
  tests.run(format($$insert into public.crew_availability (crew_id, weekday, start_time, end_time)
                     values (%L, 1, '08:00', '12:00'), (%L, 1, '13:00', '17:00')$$,
                   tests.id('crew_a'), tests.id('crew_a'))) = 'ok:2',
  'crew can insert own crew_availability (two blocks on one day)');
select tests.check(
  tests.run(format($$insert into public.crew_availability (crew_id, weekday, start_time, end_time)
                     values (%L, 1, '08:00', '12:00')$$, tests.id('crew_b'))) like 'err:42501:%',
  'crew cannot insert crew_availability for another crew member');
select tests.check((select count(*) from public.crew_availability) = 2, 'crew sees only own availability');
select tests.check(
  tests.run(format($$update public.crew_availability set end_time = '18:00' where id = %L$$, tests.id('avail_b'))) = 'ok:0'
  and tests.run(format($$delete from public.crew_availability where id = %L$$, tests.id('avail_b'))) = 'ok:0',
  'crew cannot update/delete another crew member''s availability');
select tests.check(
  tests.run(format($$update public.crew_availability set crew_id = %L where crew_id = %L$$, tests.id('crew_b'), tests.id('crew_a'))) like 'err:42501:%',
  'crew cannot move their availability onto another crew member');
select tests.check(
  tests.run($$update public.crew_availability set end_time = '12:30' where start_time = '08:00'$$) = 'ok:1'
  and tests.run($$delete from public.crew_availability where start_time = '13:00'$$) = 'ok:1',
  'crew can update and delete own availability');

-- crew_exceptions
select tests.check(
  tests.run(format($$insert into public.crew_exceptions (crew_id, date_from, date_to, kind, status, note)
                     values (%L, '2026-11-01', '2026-11-02', 'off', 'approved', 'wedding')$$, tests.id('crew_a'))) = 'ok:1',
  'crew can request time off');
select tests.check(
  (select status from public.crew_exceptions where note = 'wedding') = 'pending',
  'crew time-off request is forced to pending even when status=approved is sent');
-- (state is verified in a separate statement: a subquery in the same statement
-- would see the snapshot from before tests.run's update)
select tests.check(
  tests.run($$update public.crew_exceptions set status = 'approved', note = 'wedding' where note = 'wedding'$$) = 'ok:1',
  'crew update on own time off succeeds');
select tests.check(
  (select status from public.crew_exceptions where note = 'wedding') = 'pending',
  'crew cannot approve their own time off by update');
select tests.check(
  tests.run(format($$insert into public.crew_exceptions (crew_id, date_from, date_to) values (%L, '2026-11-01', '2026-11-01')$$,
                   tests.id('crew_b'))) like 'err:42501:%',
  'crew cannot file time off for another crew member');

-- job_assignments
select tests.check((select count(*) from public.job_assignments) = 1, 'crew sees only own assignments');
select tests.check(
  tests.run($$update public.job_assignments set status = 'accepted', responded_at = now()$$) = 'ok:1',
  'crew can accept own assignment');
select tests.check(
  (select status = 'accepted' and responded_at is not null from public.job_assignments),
  'accepted assignment is stored with responded_at');
select tests.check(
  tests.run($$update public.job_assignments set status = 'dropped'$$) like 'err:42501:%',
  'crew cannot set assignment status to dropped');
select tests.check(
  tests.run(format($$update public.job_assignments set job_id = %L$$, tests.id('job2'))) like 'err:42501:%',
  'crew cannot move an assignment to another job');
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'declined' where id = %L$$, tests.id('assign_b'))) = 'ok:0',
  'crew cannot respond to another crew member''s assignment');
select tests.check(
  tests.run(format($$insert into public.job_assignments (job_id, crew_id) values (%L, %L)$$, tests.id('job2'), tests.id('crew_a'))) like 'err:42501:%',
  'crew cannot assign themselves to a job');

-- payouts / services
select tests.check((select count(*) from public.payouts) = 1 and (select amount from public.payouts) = 45,
  'crew sees only own payouts');
select tests.check(
  tests.run($$update public.payouts set amount = 1000$$) = 'ok:0',
  'crew cannot edit payouts');
select tests.check((select count(*) from public.services) = 6, 'crew can read services');
select tests.check(
  tests.run($$update public.services set name = 'x'$$) = 'ok:0',
  'crew cannot edit services');

-- functions
select tests.check(
  tests.run($$select public.enqueue_task('quote', 'quotes', '{}')$$) like 'err:42501:%',
  'crew cannot call enqueue_task');
select tests.check(
  tests.run($$select public.ai_spend_this_month()$$) like 'err:42501:%',
  'crew cannot call ai_spend_this_month');
select tests.check(
  tests.run($$select * from public.claim_task('quotes', 'evil')$$) like 'err:42501:%',
  'crew cannot call claim_task');

reset role;

-- crew B sees their own job only
select tests.claims(tests.id('crew_b_uid'));
set role authenticated;
select tests.check(
  (select array_agg(id) from public.crew_jobs) = array[tests.id('job2')],
  'crew B sees only job2 in crew_jobs');
select tests.check(
  (select services from public.crew_jobs) = '{}'::text[],
  'crew_jobs.services is an empty array for a job without a quote');
reset role;

-- ---------------------------------------------------------------------------
\echo '# owner'
-- ---------------------------------------------------------------------------
select tests.claims(tests.id('owner_uid'));
set role authenticated;

select tests.check(public.current_role() = 'owner' and public.is_owner(), 'owner: current_role() = owner, is_owner() = true');

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'settings', 'profiles', 'services', 'customers', 'leads', 'quotes', 'quote_items',
    'jobs', 'job_assignments', 'owner_windows', 'owner_exceptions', 'crew_availability',
    'crew_exceptions', 'approvals', 'ads', 'messages', 'payouts', 'expenses', 'ai_usage',
    'fleet_workers', 'stripe_events', 'flyer_workers', 'flyer_batches', 'flyer_scans',
    'customer_interactions', 'crew_jobs'
  ] loop
    n := tests.count_rows(format('select * from public.%I', t));
    perform tests.check(n > 0, format('owner reads %s', t), n || ' rows');
  end loop;
end $$;
select tests.check((select count(*) from public.profiles) = 3, 'owner sees every profile');
select tests.check((select count(*) from public.crew_jobs) = 2, 'owner sees every job in crew_jobs');
select tests.check(
  tests.run(format($$update public.profiles set hourly_rate = 18 where id = %L$$, tests.id('crew_a'))) = 'ok:1',
  'owner can change crew hourly_rate');
select tests.check(
  tests.run($$update public.crew_exceptions set status = 'approved' where note = 'wedding'$$) = 'ok:1',
  'owner can update time off');
select tests.check(
  (select status from public.crew_exceptions where note = 'wedding') = 'approved',
  'owner can approve time off');
select tests.check(
  tests.run($$update public.settings set margin = 0.45$$) = 'ok:1',
  'owner can update settings');
select tests.check(
  tests.run($$insert into public.fleet_tasks (type, role) values ('ad_draft', 'ads')$$) = 'ok:1',
  'owner can write fleet_tasks');
select tests.check(public.ai_spend_this_month() = 0.75,
  'ai_spend_this_month sums only this month', public.ai_spend_this_month()::text);
select tests.check(
  public.enqueue_task('schedule', 'scheduler', '{"job_id":"x"}') is not null,
  'owner can call enqueue_task');
reset role;

-- ---------------------------------------------------------------------------
\echo '# task queue (service role)'
-- ---------------------------------------------------------------------------
select tests.claims(null, 'service_role');
set role service_role;

select tests.check(
  public.enqueue_task('quote', 'quotes', '{"lead_id":"L1"}', now(), 'quote:L1')
    = public.enqueue_task('quote', 'quotes', '{"lead_id":"L1"}', now(), 'quote:L1'),
  'enqueue_task returns the same id for a repeated dedupe_key');
select tests.check((select count(*) from public.fleet_tasks where dedupe_key = 'quote:L1') = 1,
  'enqueue_task dedupe inserts only one row');
select tests.check(
  public.enqueue_task('quote', 'quotes', '{}') <> public.enqueue_task('quote', 'quotes', '{}'),
  'enqueue_task without dedupe_key always inserts');
-- Leave exactly one runnable quotes task (the dedupe one) plus one in the future.
delete from public.fleet_tasks where role = 'quotes' and dedupe_key is null;
select public.enqueue_task('quote', 'quotes', '{"later":true}', now() + interval '1 hour', 'quote:later');

create temp table claimed as select * from public.claim_task('quotes', 'w2a');
select tests.check((select count(*) from claimed) = 1, 'claim_task returns one task');
select tests.check(
  (select dedupe_key = 'quote:L1' and status = 'running' and worker = 'w2a' and attempts = 1 and started_at is not null
   from claimed),
  'claimed task is running, has worker/started_at, attempts incremented');
select tests.check(
  (select count(*) from public.claim_task('quotes', 'w2b')) = 0,
  'a second claim by another worker gets nothing (future task not runnable)');
select tests.check(
  (select count(*) from public.claim_task('ads', 'w1')) = 1
  and (select count(*) from public.claim_task('ads', 'w1')) = 0,
  'claim_task only hands out tasks for the requested role');

-- fail -> requeue with backoff
select tests.check(
  public.fail_task((select id from claimed), 'geocoder timeout') = 'queued',
  'fail_task requeues while attempts remain');
select tests.check(
  (select status = 'queued' and run_after > now() and error = 'geocoder timeout' from public.fleet_tasks where id = (select id from claimed)),
  'requeued task has a backoff run_after and the error');
select tests.check((select count(*) from public.claim_task('quotes', 'w2b')) = 0,
  'task in backoff is not claimable');
-- exhaust attempts
update public.fleet_tasks set run_after = now() - interval '1 second', max_attempts = 2 where id = (select id from claimed);
select tests.check(
  (select attempts from public.claim_task('quotes', 'w2b')) = 2,
  'retry is claimable after backoff (attempt 2)');
select tests.check(
  public.fail_task((select id from claimed), 'still broken', interval '1 minute') = 'failed',
  'fail_task returns failed at max_attempts');
select tests.check(
  (select status = 'failed' and finished_at is not null and error = 'still broken'
   from public.fleet_tasks where id = (select id from claimed)),
  'task is failed with finished_at and the last error');

-- complete
select public.enqueue_task('ad_draft', 'ads', '{}', now(), 'ad:1');
select tests.check(
  (select dedupe_key from public.claim_task('ads', 'w1')) = 'ad:1',
  'claim picks the next ads task');
select public.complete_task((select id from public.fleet_tasks where dedupe_key = 'ad:1'), '{"ad_id":"A1"}');
select tests.check(
  (select status = 'done' and result = '{"ad_id":"A1"}' and finished_at is not null
   from public.fleet_tasks where dedupe_key = 'ad:1'),
  'complete_task marks done with the result');

-- stale
delete from public.fleet_tasks where role = 'scheduler';
select public.enqueue_task('schedule', 'scheduler', '{}', now(), 'sched:stale');
select tests.check((select count(*) from public.claim_task('scheduler', 'w3')) = 1, 'scheduler task claimed');
update public.fleet_tasks set started_at = now() - interval '1 hour' where dedupe_key = 'sched:stale';
select tests.check(public.requeue_stale_tasks(interval '15 minutes') = 1, 'requeue_stale_tasks finds the stale task');
select tests.check(
  (select status = 'queued' and error like 'stale:%' from public.fleet_tasks where dedupe_key = 'sched:stale'),
  'stale task is back in the queue');

select tests.check(
  tests.run($$select count(*) from public.customers$$) like 'ok:%' and (select count(*) from public.customers) = 1,
  'service role bypasses RLS');
reset role;

-- ---------------------------------------------------------------------------
\echo '# triggers and constraints'
-- ---------------------------------------------------------------------------
insert into public.expenses (category, amount, created_at, updated_at)
values ('tools', 10, '2000-01-01', '2000-01-01');
update public.expenses set amount = 11 where category = 'tools';
select tests.check(
  (select updated_at > '2001-01-01' and created_at = '2000-01-01' from public.expenses where category = 'tools'),
  'set_updated_at bumps updated_at on update');
select tests.check(
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and t.tgname = 'set_updated_at') = 35,
  'set_updated_at is attached to all 35 tables');
select tests.check(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0,
  'RLS is enabled on every public table');
select tests.check(
  tests.run($$insert into public.settings (id) values (gen_random_uuid())$$) like 'err:23514:%'
  and tests.run($$insert into public.settings (id) values ('00000000-0000-0000-0000-000000000001')$$) like 'err:23505:%',
  'a second settings row is impossible');
select tests.check(
  tests.run($$delete from public.settings$$) like 'err:%',
  'the settings row cannot be deleted');
select tests.check(
  tests.run($$update public.settings set margin = 0.96$$) like 'err:23514:%'
  and tests.run($$update public.settings set margin = 0.95$$) = 'ok:1',
  'settings.margin limited to 0..0.95');
select tests.check(
  tests.run($$insert into public.owner_windows (weekday, start_time, end_time) values (7, '09:00', '10:00')$$) like 'err:23514:%',
  'weekday must be 0..6');
select tests.check(
  tests.run($$insert into public.owner_windows (weekday, start_time, end_time) values (1, '9:00', '10:00')$$) like 'err:23514:%'
  and tests.run($$insert into public.owner_windows (weekday, start_time, end_time) values (1, '09:00', '25:00')$$) like 'err:23514:%'
  and tests.run($$insert into public.owner_windows (weekday, start_time, end_time) values (1, '12:00', '11:00')$$) like 'err:23514:%',
  'times must be HH:MM and end after start');
select tests.check(
  tests.run(format($$insert into public.crew_exceptions (crew_id, date_from, date_to) values (%L, '2026-11-02', '2026-11-01')$$, tests.id('crew_a'))) like 'err:23514:%',
  'crew_exceptions date_to must be >= date_from');
select tests.check(
  tests.run(format($$insert into public.leads (customer_id, preferred_days) values (%L, '{1,9}')$$, tests.id('customer'))) like 'err:23514:%',
  'leads.preferred_days must be weekdays 0..6');
select tests.check(
  tests.run(format($$insert into public.quotes (lead_id, customer_id, margin) values (%L, %L, 0.99)$$, tests.id('lead'), tests.id('customer'))) like 'err:23514:%',
  'quotes.margin limited to 0..0.95');
select tests.check(
  tests.run($$insert into public.services (slug, name, minutes_rule) values ('bad', 'Bad', '{"base": 1}')$$) like 'err:23514:%',
  'services.minutes_rule shape is checked');
select tests.check(
  tests.run($$insert into public.fleet_tasks (type, role, dedupe_key) values ('quote', 'quotes', 'quote:L1')$$) like 'err:23505:%',
  'fleet_tasks.dedupe_key is unique when set');
select tests.check(
  (select count(*) from public.customers where unsubscribe_token ~ '^[0-9a-f]{32}$') = 1,
  'customers get a random unsubscribe_token');
-- auth user deletion cascades to the profile
insert into auth.users (id, email, invited_at) values ('00000000-0000-0000-0000-0000000000c1', 'temp@example.com', now());
select tests.check(
  (select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c1') = 1,
  'invited temp user has a profile before deletion');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';
select tests.check(
  (select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c1') = 0,
  'deleting an auth user deletes the profile');
-- 1400 flyer workers
select tests.check(
  (select amount = 31.25 from public.flyer_batches where flyer_worker_id = tests.id('flyer_worker')),
  'flyer_batches.amount is flyer_count × rate (250 × $0.125 = $31.25)');
select tests.check(
  (select rate_per_flyer = 0.10 from public.flyer_workers where id = tests.id('flyer_worker')),
  'flyer_workers.rate_per_flyer defaults to $0.10');
select tests.check(
  tests.run($$insert into public.flyer_workers (name, code) values ('Dup', 'K7M2')$$) like 'err:23505:%',
  'flyer_workers.code is unique');
select tests.check(
  tests.run($$insert into public.flyer_workers (name, code) values ('Lower', 'k7m2')$$) like 'err:23514:%',
  'flyer_workers.code must be 4-8 upper-case letters / digits');
select tests.check(
  tests.run(format($$insert into public.flyer_batches (flyer_worker_id, flyer_count, rate) values (%L, 0, 0.1)$$, tests.id('flyer_worker'))) like 'err:23514:%',
  'flyer_batches needs at least one flyer');
select tests.check(
  tests.run(format($$delete from public.flyer_workers where id = %L$$, tests.id('flyer_worker'))) like 'err:23503:%',
  'a flyer worker with batches cannot be deleted (pay history is kept)');
-- 1500 price log
select tests.check(
  (select status = 'open' and talked_on = current_date from public.customer_interactions where customer_id = tests.id('customer')),
  'customer_interactions default to open, talked today');
select tests.check(
  tests.run(format($$insert into public.customer_interactions (customer_id, category, status) values (%L, 'Snow', 'maybe')$$, tests.id('customer'))) like 'err:23514:%',
  'customer_interactions.status is open / booked / passed');
select tests.check(
  tests.run(format($$insert into public.customer_interactions (customer_id, category, price) values (%L, 'Snow', -5)$$, tests.id('customer'))) like 'err:23514:%',
  'customer_interactions.price cannot be negative');
select tests.check(
  tests.run(format($$insert into public.customer_interactions (customer_id, category) values (%L, '  ')$$, tests.id('customer'))) like 'err:23514:%',
  'customer_interactions.category is required');

-- ---------------------------------------------------------------------------
\echo '# 0800 guards: assignment status edges, invite-only auth hook'
-- ---------------------------------------------------------------------------
reset role;
select tests.claims(null, 'service_role');
-- Three more jobs for crew A, one assignment each in a different state.
with j as (
  insert into public.jobs (customer_id, status, est_minutes, crew_size, notes)
  select tests.id('customer'), 'proposed', 60, 1, 'guard test ' || g from generate_series(1, 3) g
  returning id, notes
) insert into tests.fx select 'gjob' || right(notes, 1), id from j;
with a as (
  insert into public.job_assignments (job_id, crew_id, status, swap_to_crew_id)
  values (tests.id('gjob1'), tests.id('crew_a'), 'swap_offered', tests.id('crew_b'))
  returning id
) insert into tests.fx select 'g_swap', id from a;
with a as (
  insert into public.job_assignments (job_id, crew_id, status)
  values (tests.id('gjob2'), tests.id('crew_a'), 'dropped')
  returning id
) insert into tests.fx select 'g_dropped', id from a;
with a as (
  insert into public.job_assignments (job_id, crew_id, status)
  values (tests.id('gjob3'), tests.id('crew_a'), 'offered')
  returning id
) insert into tests.fx select 'g_offered', id from a;

select tests.claims(tests.id('crew_a_uid'));
set role authenticated;
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'accepted', responded_at = now() where id = %L$$, tests.id('g_swap'))) like 'err:42501:%',
  'crew cannot flip a swap_offered assignment to accepted directly (swap accept is a server action)');
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'accepted', responded_at = now() where id = %L$$, tests.id('g_dropped'))) like 'err:42501:%',
  'crew cannot flip a dropped assignment back to accepted');
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'accepted', responded_at = now() where id = %L$$, tests.id('g_offered'))) = 'ok:1',
  'crew can still accept an offered assignment');
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'swap_offered' where id = %L$$, tests.id('g_offered'))) like 'err:42501:%',
  'crew cannot set their own accepted assignment to swap_offered');
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'drop_requested', responded_at = now() where id = %L$$, tests.id('g_offered'))) = 'ok:1',
  'crew can ask to drop an accepted assignment (accepted -> drop_requested)');
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'accepted' where id = %L$$, tests.id('g_offered'))) like 'err:42501:%',
  'crew cannot take back a drop request themselves (drop_requested -> accepted)');
reset role;
select tests.claims(null, 'service_role');
set role service_role;
select tests.check(
  tests.run(format($$update public.job_assignments set status = 'accepted' where id = %L$$, tests.id('g_swap'))) = 'ok:1',
  'service role can still accept a swap (swap_offered -> accepted)');
reset role;

-- Auth hook: only owner-invited users get a profile.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'stranger@example.com', '{"name":"Self Signup"}');
insert into auth.users (id, phone, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d2', '+14405550111', '{"name":"Phone Self Signup"}');
insert into auth.users (id, phone, phone_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d3', '+14405550112', now(), '{"name":"Phone Crew"}'),
  ('00000000-0000-0000-0000-0000000000d4', '+14405550113', now(), '{}');
select tests.check(
  (select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-0000000000d1') = 0,
  'an auth.users insert without invite markers creates no profile (self sign-up is not crew)');
select tests.check(
  (select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-0000000000d2') = 0,
  'an unconfirmed phone sign-up with a name in metadata creates no profile');
select tests.check(
  (select role = 'crew' and name = 'Phone Crew' and phone = '+14405550112'
     from public.profiles where user_id = '00000000-0000-0000-0000-0000000000d3'),
  'an admin-created phone user (phone confirmed + name metadata) gets a crew profile');
select tests.check(
  (select count(*) from public.profiles where user_id = '00000000-0000-0000-0000-0000000000d4') = 0,
  'a confirmed phone user without name metadata creates no profile');

-- ---------------------------------------------------------------------------
\echo '# 1800 canvass: crew reads parcels + settings, writes own knocks; hangers / summaries owner-only'
-- ---------------------------------------------------------------------------
reset role;
select tests.claims(null, 'service_role');

select tests.check((select count(*) from public.canvass_settings) = 1, 'canvass_settings has exactly one row');
select tests.check((select id from public.canvass_settings) = '00000000-0000-0000-0000-000000000001', 'canvass_settings row has the fixed id');
select tests.check(
  (select hardscape_pct = 0.12 and not value_tier_enabled and value_tier_max = 1.10
          and doors_per_hour = 25 and neighbor_n = 3 and recency_days = 14 and work_hours = 8.5 and learned_min_knocks = 8
          and acs_vintage = '2023' and offer_text is null and parcel_field_map = '{}'::jsonb
   from public.canvass_settings),
  'canvass_settings defaults match the spec');
select tests.check(
  (select season_map ->> '1' = 'snow' and season_map ->> '4' = 'mow' and season_map ->> '9' = 'leaf_cleanup' and season_map ->> '12' = 'snow'
          and residential_land_use_prefixes = '{"510","511","512","513","514","515","516","517","518","519"}'::text[]
   from public.canvass_settings),
  'canvass_settings.season_map / residential prefixes default as in lib/canvass/types.ts');
select tests.check(
  (select price_tiers #>> '{leaf_cleanup,small}' = '30' and price_tiers #>> '{leaf_cleanup,medium}' = '40'
          and price_tiers #>> '{leaf_cleanup,large}' = '50' and (price_tiers -> 'leaf_cleanup' -> 'xl') = 'null'::jsonb
          and (price_tiers -> 'mow' -> 'medium') = 'null'::jsonb and (select count(*) from jsonb_object_keys(price_tiers)) = 5
          and tier_bounds = '{"small_max":4000,"medium_max":8000,"large_max":12000}'::jsonb
          and (select count(*) from jsonb_object_keys(tier_minutes)) = 5 and (tier_minutes -> 'snow' -> 'xl') = 'null'::jsonb
          and crew_size = 3 and pay_rate = 15 and walk_doors = 25
          and score_weights = '{"time":1,"lawn":1,"customer":1,"owner":1}'::jsonb
   from public.canvass_settings),
  'canvass_settings v3 pricing tiers / bounds / minutes / crew / weights / walk_doors default as in lib/canvass/types.ts');
select tests.check(
  tests.run($$update public.canvass_settings set crew_size = 0$$) like 'err:23514:%'
  and tests.run($$update public.canvass_settings set pay_rate = -1$$) like 'err:23514:%'
  and tests.run($$update public.canvass_settings set walk_doors = 0$$) like 'err:23514:%'
  and tests.run($$update public.canvass_settings set walk_doors = 201$$) like 'err:23514:%'
  and tests.run($$update public.canvass_settings set price_tiers = '[]'::jsonb$$) like 'err:23514:%'
  and tests.run($$update public.canvass_settings set score_weights = '5'::jsonb$$) like 'err:23514:%',
  'canvass_settings v3 checks: crew_size >= 1, pay_rate >= 0, walk_doors 1..200, jsonb columns are objects');
select tests.check(
  (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'canvass_settings' and column_name in ('base_prices', 'rate_per_1000_sqft', 'min_charge') limit 1) is null
  and (select state from public.parcels limit 0) is null,
  'canvass_settings v1 pricing columns are gone; parcels.state exists');
select tests.check(
  tests.run($$insert into public.canvass_settings (id) values ('00000000-0000-0000-0000-000000000002')$$) like 'err:23514:%',
  'canvass_settings is a singleton');
select tests.check(
  tests.run($$update public.canvass_settings set value_tier_max = 1.5$$) like 'err:23514:%',
  'canvass_settings.value_tier_max is capped at 1.10');
select tests.check(
  (select array_agg(name order by sort_order) from public.pitches) = array['Neighbor special', 'Season focus', 'Landlord / rental']
  and (select bool_and(active) from public.pitches),
  'pitches seeded with the three starter scripts, all active');

-- Fixtures (as a trusted caller): one block group, two parcels (one do-not-knock), a plan, a hanger
-- code with a scan, a summary, and one knock by crew A.
insert into public.block_groups (geoid, pct_not_in_lf, pct_hh_nonworking_parent, acs_vintage, fetched_at)
values ('390351001001', 0.42, 0.30, '2023', now());
with p as (
  insert into public.parcels (parcel_id, address, street, city, zip, owner_display, lot_sqft, living_sqft, stories,
                              centroid_lat, centroid_lng, block_group_geoid, raw)
  values ('301-01-001', '1 LAKE RD', 'LAKE RD', 'ROCKY RIVER', '44116', 'Pat Homeowner', 8000, 1600, 2,
          41.48, -81.84, '390351001001', '{"parcelpin":"301-01-001"}')
  returning id
) insert into tests.fx select 'parcel', id from p;
with p as (
  insert into public.parcels (parcel_id, address, street, do_not_knock, do_not_knock_reason)
  values ('301-01-002', '3 LAKE RD', 'LAKE RD', true, 'No Soliciting sign')
  returning id
) insert into tests.fx select 'parcel_dnk', id from p;
insert into public.canvass_plans (for_date, slot_start, slot_end, parcel_ids, created_by)
values (current_date, '15:00', '17:00', array[tests.id('parcel')], tests.id('owner'));
insert into public.hanger_codes (code, street, block_group_geoid) values ('LAKE7', 'LAKE RD', '390351001001');
insert into public.hanger_events (code, event, visitor) values ('LAKE7', 'scan', 'v1');
insert into public.hanger_events (code, event, lead_id) values ('LAKE7', 'booking', tests.id('lead'));
insert into public.canvass_summaries (for_date, summary, model)
values (current_date - 1, '{"headline":"Quiet day","highlights":[]}', 'claude-sonnet-5-5');
with k as (
  insert into public.knocks (parcel_id, knocker_id, outcome, pitch_id, lat, lng, weather, client_id)
  select tests.id('parcel'), tests.id('crew_a'), 'no_answer', (select id from public.pitches order by sort_order limit 1),
         41.48, -81.84, '{"temp_f":52,"precip_in":0,"code":3,"label":"Overcast"}', 'phone-1'
  returning id
) insert into tests.fx select 'knock_a', id from k;
insert into public.knocks (parcel_id, knocker_id, outcome, client_id)
values (tests.id('parcel'), tests.id('crew_b'), 'not_interested', 'phone-2');

-- Constraints.
select tests.check(
  tests.run($$insert into public.parcels (parcel_id, address) values ('301-01-001', 'dup')$$) like 'err:23505:%',
  'parcels.parcel_id is unique');
select tests.check(
  tests.run($$insert into public.parcels (parcel_id, centroid_lat, centroid_lng) values ('301-01-009', 95, 0)$$) like 'err:23514:%',
  'parcels centroid must be a valid lat/lng');
select tests.check(
  tests.run($$insert into public.parcels (parcel_id, lot_sqft) values ('301-01-009', -1)$$) like 'err:23514:%',
  'parcels sizes cannot be negative');
select tests.check(
  tests.run($$insert into public.parcels (parcel_id, raw) values ('301-01-009', '[]')$$) like 'err:23514:%',
  'parcels.raw must be a JSON object');
select tests.check(
  tests.run($$insert into public.block_groups (geoid) values ('39035')$$) like 'err:23514:%',
  'block_groups.geoid is a 12-digit GEOID');
select tests.check(
  tests.run(format($$insert into public.knocks (parcel_id, knocker_id, outcome, client_id) values (%L, %L, 'booked', 'phone-1')$$,
                   tests.id('parcel'), tests.id('crew_a'))) like 'err:23505:%',
  'knocks.client_id is unique (offline re-sends are rejected, not duplicated)');
select tests.check(
  tests.run(format($$insert into public.knocks (parcel_id, knocker_id, outcome) values (%L, %L, 'maybe')$$,
                   tests.id('parcel'), tests.id('crew_a'))) like 'err:22P02:%',
  'knocks.outcome is the knock_outcome enum');
select tests.check(
  tests.run($$insert into public.hanger_codes (code, street) values ('lake7', 'LAKE RD')$$) like 'err:23514:%',
  'hanger_codes.code must be 4-8 upper-case letters / digits');
select tests.check(
  tests.run($$insert into public.hanger_events (code, event) values ('NOPE1', 'scan')$$) like 'err:23503:%',
  'hanger_events.code must reference a hanger code');
select tests.check(
  tests.run($$insert into public.canvass_plans (for_date, slot_start, slot_end) values (current_date, '3pm', '17:00')$$) like 'err:23514:%',
  'canvass_plans slot times are HH:MM');
select tests.check(
  tests.run($$insert into public.canvass_summaries (for_date, summary) values (current_date - 1, '{}')$$) like 'err:23505:%',
  'canvass_summaries has one row per day');
select tests.check(
  tests.run($$insert into public.canvass_summaries (for_date, summary) values (current_date - 2, '"text"')$$) like 'err:23514:%',
  'canvass_summaries.summary must be a JSON object');
select tests.check(
  tests.run(format($$delete from public.profiles where id = %L$$, tests.id('crew_a'))) like 'err:23503:%',
  'a crew member with knocks cannot be deleted (knock log is kept)');

-- anon: nothing.
select tests.claims(null, 'anon');
set role anon;
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'parcels', 'block_groups', 'knocks', 'pitches', 'hanger_codes', 'hanger_events',
    'canvass_plans', 'canvass_summaries', 'canvass_settings'
  ] loop
    n := tests.count_rows(format('select * from public.%I', t));
    perform tests.check(n <= 0, format('anon reads nothing from %s', t),
                        case when n = -1 then 'permission denied' else n || ' rows' end);
  end loop;
end $$;
select tests.check(
  tests.run(format($$insert into public.knocks (parcel_id, knocker_id, outcome) values (%L, %L, 'booked')$$,
                   tests.id('parcel'), tests.id('crew_a'))) like 'err:42501:%',
  'anon cannot insert knocks');
reset role;

-- crew A: read parcels / block_groups / pitches / settings / plans; own knocks only; no hangers / summaries.
select tests.claims(tests.id('crew_a_uid'));
set role authenticated;
select tests.check((select count(*) from public.parcels) = 2, 'crew can read parcels');
select tests.check((select count(*) from public.canvass_settings) = 1, 'crew can read canvass_settings');
select tests.check((select count(*) from public.block_groups) = 1, 'crew can read block_groups');
select tests.check((select count(*) from public.pitches) = 3, 'crew can read pitches');
select tests.check((select count(*) from public.canvass_plans) = 1, 'crew can read canvass_plans');
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['hanger_events', 'canvass_summaries', 'hanger_codes'] loop
    n := tests.count_rows(format('select * from public.%I', t));
    perform tests.check(n <= 0, format('crew reads nothing from %s', t),
                        case when n = -1 then 'permission denied' else n || ' rows' end);
  end loop;
end $$;
select tests.check(
  tests.run($$update public.parcels set do_not_knock = true$$) = 'ok:0'
  and tests.run($$update public.canvass_settings set doors_per_hour = 1$$) = 'ok:0'
  and tests.run($$update public.pitches set active = false$$) = 'ok:0',
  'crew cannot edit parcels / canvass_settings / pitches');
select tests.check(
  tests.run($$insert into public.parcels (parcel_id) values ('crew-made')$$) like 'err:42501:%',
  'crew cannot insert parcels');
select tests.check(
  tests.run(format($$insert into public.knocks (parcel_id, knocker_id, outcome, callback_window, client_id)
                     values (%L, %L, 'call_back', 'weekdays after 5', 'phone-3')$$,
                   tests.id('parcel'), tests.id('crew_a'))) = 'ok:1',
  'crew can insert a knock with their own knocker_id');
select tests.check(
  tests.run(format($$insert into public.knocks (parcel_id, knocker_id, outcome, client_id) values (%L, %L, 'booked', 'phone-4')$$,
                   tests.id('parcel'), tests.id('crew_b'))) like 'err:42501:%',
  'crew cannot insert a knock for another crew member');
select tests.check(
  (select count(*) from public.knocks) = 2 and (select bool_and(knocker_id = tests.id('crew_a')) from public.knocks),
  'crew sees only their own knocks');
select tests.check(
  tests.run($$update public.knocks set outcome = 'booked'$$) = 'ok:0'
  and tests.run($$delete from public.knocks$$) = 'ok:0',
  'crew cannot update or delete knocks');
select tests.check(
  tests.run($$insert into public.hanger_events (code, event) values ('LAKE7', 'scan')$$) like 'err:42501:%',
  'crew cannot insert hanger_events');
reset role;

-- owner: everything.
select tests.claims(tests.id('owner_uid'));
set role authenticated;
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'parcels', 'block_groups', 'knocks', 'pitches', 'hanger_codes', 'hanger_events',
    'canvass_plans', 'canvass_summaries', 'canvass_settings'
  ] loop
    n := tests.count_rows(format('select * from public.%I', t));
    perform tests.check(n > 0, format('owner reads %s', t), n || ' rows');
  end loop;
end $$;
select tests.check((select count(*) from public.knocks) = 3, 'owner sees every knock');
select tests.check(
  tests.run($$update public.canvass_settings set doors_per_hour = 30, offer_text = 'Fall special'$$) = 'ok:1'
  and tests.run(format($$update public.parcels set home_pattern = 'evenings_only' where id = %L$$, tests.id('parcel'))) = 'ok:1'
  and tests.run($$insert into public.hanger_codes (code, street) values ('ELM2', 'ELM AVE')$$) = 'ok:1',
  'owner can edit canvass_settings / parcels and create hanger codes');
reset role;

-- ---------------------------------------------------------------------------
\echo '# summary'
-- ---------------------------------------------------------------------------
do $$
declare
  passed bigint;
  failed bigint;
  r record;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into passed, failed from tests.results;
  raise notice '% passed, % failed', passed, failed;
  for r in select n, description, detail from tests.results where not ok order by n loop
    raise notice '  FAILED #%: % %', r.n, r.description, coalesce('(' || r.detail || ')', '');
  end loop;
  if failed > 0 then
    raise exception '% database test(s) failed', failed;
  end if;
end $$;
