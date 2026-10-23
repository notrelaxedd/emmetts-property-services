-- =============================================================================
-- 1500 — Flyer map: which streets have had flyers.
--   flyer_streets       street segments from OpenStreetMap (one row per OSM way), loaded the first
--                       time the owner looks at an area. path = [[lat, lng], ...]; the min/max
--                       columns are its bounding box, for "streets in this view" lookups.
--   flyer_street_areas  0.02° grid cells already loaded from OpenStreetMap (cell = "<lat idx>:<lng idx>").
--   flyer_street_marks  one row each time the owner marks a street covered (history kept; the newest
--                       mark decides the colour). flyer_worker_id = who handed them out, if known.
-- Owner-only like the rest of the flyer tables.
-- =============================================================================

create table public.flyer_streets (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  osm_id      bigint not null unique,
  name        text not null,
  kind        text not null,
  path        jsonb not null,
  min_lat     double precision not null,
  max_lat     double precision not null,
  min_lng     double precision not null,
  max_lng     double precision not null,
  constraint flyer_streets_path check (jsonb_typeof(path) = 'array' and jsonb_array_length(path) >= 2),
  constraint flyer_streets_bbox check (min_lat <= max_lat and min_lng <= max_lng)
);
create index flyer_streets_bbox_idx on public.flyer_streets (min_lat, max_lat, min_lng, max_lng);

create table public.flyer_street_areas (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  cell          text not null unique,
  street_count  integer not null default 0,
  constraint flyer_street_areas_cell check (cell ~ '^-?\d+:-?\d+$')
);

create table public.flyer_street_marks (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  street_id        uuid not null references public.flyer_streets (id) on delete cascade,
  flyer_worker_id  uuid references public.flyer_workers (id) on delete set null,
  covered_on       date not null default current_date
);
create index flyer_street_marks_street_idx on public.flyer_street_marks (street_id, covered_on desc, created_at desc);
create index flyer_street_marks_worker_idx on public.flyer_street_marks (flyer_worker_id) where flyer_worker_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['flyer_streets', 'flyer_street_areas', 'flyer_street_marks'] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using ((select public.is_owner())) with check ((select public.is_owner()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

comment on table public.flyer_streets is
  'Street segments (OpenStreetMap ways) for the flyer map, loaded per area on first view. path = [[lat, lng], ...].';
comment on table public.flyer_street_marks is
  'Each time a street was marked as flyered. The newest mark per street decides its colour on the map.';
