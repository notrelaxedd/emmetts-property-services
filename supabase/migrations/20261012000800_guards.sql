-- =============================================================================
-- 0800 — Tighter guards
--
--   job_assignments_guard() ... crew may only make the transitions the crew app
--                               offers through RLS (see below); everything else
--                               goes through server actions on the service role.
--   handle_new_user() ......... a profile is created only for users the owner
--                               invited (no more "every sign-up becomes crew").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- job_assignments: an untrusted (crew) caller may change only `status` and
-- `responded_at` on their own rows (row ownership is enforced by RLS), and the
-- status may only move along these edges:
--
--   offered  -> accepted        (accept an offer)
--   offered  -> declined        (decline an offer)
--   accepted -> drop_requested  (ask to drop inside the notice window)
--
-- Swap accept / decline, `dropped`, and putting a rejected drop back to
-- `accepted` are done by server actions / handlers with the service role, so a
-- crew member can't, for example, flip a `swap_offered` or `dropped` row to
-- `accepted` straight through the REST API.
-- -----------------------------------------------------------------------------
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
       and not (   (old.status = 'offered'  and new.status in ('accepted', 'declined'))
                or (old.status = 'accepted' and new.status = 'drop_requested')) then
      raise exception 'crew cannot change assignment status from % to %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auth hook: create a `crew` profile only for users the owner invited.
--
--   * email invite (`auth.admin.inviteUserByEmail`, or Dashboard → Invite user):
--     Supabase sets `invited_at`;
--   * phone crew created from /admin/employees (`auth.admin.createUser` with
--     `phone_confirm: true` and `user_metadata: { name }`): the phone is already
--     confirmed at insert time and the metadata carries `name`. A self sign-up
--     by phone is inserted unconfirmed (confirmation is a later UPDATE), so it
--     doesn't qualify.
--
-- Anyone else (public sign-up left switched on by mistake, a Dashboard
-- "Add user") gets no profile, so no crew access. The invite action also
-- upserts the profile itself, so this is a safety net, not the only path.
-- Role is never read from user metadata. The columns are read via to_jsonb()
-- so the function also works against the local test shim's auth.users.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  u jsonb := to_jsonb(new);
begin
  if not (
       (u ->> 'invited_at') is not null
    or ((u ->> 'phone_confirmed_at') is not null and coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'name')
  ) then
    return new;
  end if;

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
