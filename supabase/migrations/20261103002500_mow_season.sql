-- Mowing season: outside these dates no lawn is due and the route is empty. Null = no limit.
alter table public.mow_settings
  add column if not exists season_start date,
  add column if not exists season_end date,
  add constraint mow_settings_season check (season_start is null or season_end is null or season_end >= season_start);

update public.mow_settings set season_start = '2026-04-01', season_end = '2026-11-30'
where id = '00000000-0000-0000-0000-000000000001' and season_start is null and season_end is null;
