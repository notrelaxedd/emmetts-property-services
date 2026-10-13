-- =============================================================================
-- 1000 — Role helpers are for signed-in users and RLS policies only.
-- The Supabase security advisor flagged them as SECURITY DEFINER functions the
-- anon role could call via /rest/v1/rpc. They return null/false for anon anyway,
-- but there is no reason to expose them.
-- =============================================================================
revoke execute on function public."current_role"()     from public, anon;
revoke execute on function public.is_owner()           from public, anon;
revoke execute on function public.current_profile_id() from public, anon;
grant  execute on function public."current_role"()     to authenticated, service_role;
grant  execute on function public.is_owner()           to authenticated, service_role;
grant  execute on function public.current_profile_id() to authenticated, service_role;
