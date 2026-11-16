-- =============================================================================
-- 20261116000100 — Map tab: where a day's route can start from.
--   settings.route_starts  the saved start points (school, my house, Emmett's house): a JSON array of
--                          { key, address, lat, lng }. Set from /admin/map; the address is geocoded on
--                          save. Empty = routes start from the service-area centre (base_lat/lng).
-- Owner-only like the rest of settings (RLS in 0500).
-- =============================================================================

alter table public.settings
  add column route_starts jsonb not null default '[]'::jsonb,
  add constraint settings_route_starts_arr check (jsonb_typeof(route_starts) = 'array');

comment on column public.settings.route_starts is
  'Map tab start points: [{ key: school|home|emmett, address, lat, lng }].';
