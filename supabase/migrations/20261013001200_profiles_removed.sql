-- =============================================================================
-- 1200 — Soft-removed team members.
-- A crew member with payouts or completed work can't be deleted (payouts.crew_id is
-- ON DELETE RESTRICT), so the owner console marks them removed instead: removed_at is
-- set, paused = true, and their auth user is banned. Restoring clears all three.
-- =============================================================================
alter table public.profiles add column removed_at timestamptz;

create index profiles_removed_idx on public.profiles (removed_at) where removed_at is not null;

comment on column public.profiles.removed_at is
  'Set when the owner removes a team member who has payouts or completed jobs (soft remove). Such profiles are hidden from the team list, skipped by the scheduler, and their auth user is banned. Null = active.';
