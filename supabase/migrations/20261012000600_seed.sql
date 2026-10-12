-- =============================================================================
-- 0600 — Seed data: settings row, services catalogue, owner windows.
-- Safe to re-run (on conflict do nothing / guarded inserts).
-- =============================================================================

-- settings: the single row, all defaults from the table definition.
--   ai_monthly_cap = null  -- TODO [CAP $]      (set in /admin once decided)
--   min_job_price  = null  -- TODO [MIN PRICE]
insert into public.settings (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- services: slugs match lib/services.ts, plus `edging`. All auto-quoted.
-- minutes_rule: base minutes + per_acre minutes, scaled by tree_cover multiplier.
-- Leaves and gutters scale hardest with trees; edging and snow barely at all.
insert into public.services (slug, name, auto_quote, default_crew_size, minutes_rule, seasonal, sort_order)
values
  -- Bundle: leaf removal + edging + gutter cleaning, priced as one visit.
  ('fall-cleanup',    'Fall Lawn Cleanup (leaf removal + edging + gutters)', true, 2,
     '{"base": 90, "per_acre": 120, "tree_cover": {"none": 1.0, "light": 1.25, "medium": 1.5, "heavy": 1.85}}', 'fall',          10),
  ('leaf-removal',    'Leaf Blowing & Removal',   true, 2,
     '{"base": 45, "per_acre": 90,  "tree_cover": {"none": 1.0, "light": 1.25, "medium": 1.55, "heavy": 1.9}}',  'fall',          20),
  ('edging',          'Edging',                   true, 1,
     '{"base": 20, "per_acre": 20,  "tree_cover": {"none": 1.0, "light": 1.05, "medium": 1.1, "heavy": 1.15}}',  'all',           30),
  ('gutter-cleaning', 'Gutter Cleaning',          true, 2,
     '{"base": 60, "per_acre": 15,  "tree_cover": {"none": 1.0, "light": 1.2, "medium": 1.45, "heavy": 1.75}}',  'fall',          40),
  ('lawn-mowing',     'Lawn Mowing & Maintenance', true, 1,
     '{"base": 25, "per_acre": 50,  "tree_cover": {"none": 1.0, "light": 1.15, "medium": 1.35, "heavy": 1.6}}',  'spring-summer', 50),
  ('snow-removal',    'Snow Removal',             true, 2,
     '{"base": 30, "per_acre": 20,  "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.05, "heavy": 1.1}}',   'winter',        60)
on conflict (slug) do nothing;

-- owner_windows: Monday (1) through Saturday (6), 09:00–18:00.
insert into public.owner_windows (weekday, start_time, end_time)
select d, '09:00', '18:00'
from generate_series(1, 6) as d
where not exists (select 1 from public.owner_windows);
