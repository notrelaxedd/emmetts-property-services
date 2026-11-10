-- =============================================================================
-- 20261110000100 — Who booked a /door lead.
--   leads.door_rep  the sales rep's name, typed on /door (null for every other source).
-- Plain text, not a profile link: reps on /door aren't signed in, and new hires can book on day one.
-- =============================================================================

alter table public.leads
  add column door_rep text,
  add constraint leads_door_rep check (door_rep is null or length(trim(door_rep)) between 1 and 60);

create index leads_door_rep_idx on public.leads (lower(door_rep)) where door_rep is not null;

comment on column public.leads.door_rep is 'Sales rep who booked this lead on /door (their name as typed).';
