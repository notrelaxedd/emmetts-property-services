-- =============================================================================
-- Minimal stand-in for the parts of Supabase that the migrations depend on, so
-- they can be applied to a plain Postgres 16 database for local testing.
-- NOT a migration — never apply this to the real Supabase project.
--
--   * roles anon / authenticated / service_role (service_role has BYPASSRLS)
--   * schema auth: auth.users, auth.uid(), auth.role(), auth.jwt()
--   * Supabase-style default privileges on schema public
--
-- Simulate a signed-in user with:
--   set role authenticated;
--   set request.jwt.claims = '{"sub":"<auth user uuid>","role":"authenticated"}';
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;
alter role service_role bypassrls;

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  phone               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'role', '')
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant all on auth.users to service_role;

-- Supabase-style privileges: the API roles can use schema public and get full
-- table privileges on everything created there (RLS is what restricts them).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
