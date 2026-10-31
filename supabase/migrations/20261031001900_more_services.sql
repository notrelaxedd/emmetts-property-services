-- =============================================================================
-- 1900 — More services: edging gets a site card; mulching, weeding, bush trimming, shrub removal,
--   light tree trimming, pressure washing and junk removal join the catalogue.
--
--   Slugs match lib/services.ts (the site's list) so the quote form, the quote engine and Stripe
--   lines all refer to the same thing. `on conflict (slug) do nothing`, so a row the owner already
--   made by hand is left alone.
--
--   auto_quote = true  : the quote engine prices it from lot size and tree cover (minutes_rule).
--   auto_quote = false : the job can't be sized from the lot alone (how much junk? how many shrubs?),
--                        so the engine adds the line and asks the owner for the price (an approval
--                        card, like a custom request). minutes_rule still gives the crew-hours guess
--                        the owner starts from. Once priced, the line bills through Stripe or
--                        cash / check like any other.
--
--   sort_order groups them the way the site does: seasonal cleanups 10–60 (seeded), lawn care 100s,
--   beds & shrubs 200s, exterior & hauling 300s. Edging moves from 30 into the lawn-care group.
-- =============================================================================

update public.services set sort_order = 110 where slug = 'edging' and sort_order = 30;

insert into public.services (slug, name, auto_quote, default_crew_size, minutes_rule, seasonal, sort_order)
values
  -- Lawn care
  ('weeding',          'Weeding',                  true,  1,
     '{"base": 30, "per_acre": 60,  "tree_cover": {"none": 1.0, "light": 1.05, "medium": 1.1, "heavy": 1.2}}',   'spring-summer', 120),
  -- Beds, shrubs & trees
  ('mulching',         'Mulching',                 true,  2,
     '{"base": 60, "per_acre": 120, "tree_cover": {"none": 1.0, "light": 1.05, "medium": 1.1, "heavy": 1.2}}',   'spring-summer', 210),
  ('bush-trimming',    'Bush & Shrub Trimming',    true,  1,
     '{"base": 45, "per_acre": 90,  "tree_cover": {"none": 1.0, "light": 1.1, "medium": 1.25, "heavy": 1.5}}',   'spring-summer', 220),
  ('shrub-removal',    'Shrub & Bush Removal',     false, 2,
     '{"base": 60, "per_acre": 0,   "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.0, "heavy": 1.0}}',    'all',           230),
  ('tree-trimming',    'Light Tree Trimming',      false, 2,
     '{"base": 60, "per_acre": 30,  "tree_cover": {"none": 1.0, "light": 1.25, "medium": 1.5, "heavy": 2.0}}',   'all',           240),
  -- Pressure washing & hauling
  ('pressure-washing', 'Pressure Washing',         false, 1,
     '{"base": 90, "per_acre": 0,   "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.0, "heavy": 1.0}}',    'spring-summer', 310),
  ('junk-removal',     'Junk Removal',             false, 2,
     '{"base": 60, "per_acre": 0,   "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.0, "heavy": 1.0}}',    'all',           320)
on conflict (slug) do nothing;
