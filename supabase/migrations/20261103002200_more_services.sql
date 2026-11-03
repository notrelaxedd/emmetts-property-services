-- More services on the quote form: edging (already there), mulching, bed cleanouts, bush trimming,
-- pressure washing. Mulching and pressure washing depend on beds / surfaces we can't see from a
-- parcel, so they come to the owner to price (auto_quote = false). Sort order follows the site list.
insert into public.services (slug, name, auto_quote, default_crew_size, minutes_rule, seasonal, sort_order)
values
  ('mulching',         'Mulching',         false, 2,
     '{"base": 60, "per_acre": 120, "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.0, "heavy": 1.0}}',  'spring-summer', 40),
  ('bed-cleanout',     'Bed Cleanouts',    true,  2,
     '{"base": 45, "per_acre": 90,  "tree_cover": {"none": 1.0, "light": 1.15, "medium": 1.3, "heavy": 1.5}}', 'all',           50),
  ('bush-trimming',    'Bush Trimming',    true,  1,
     '{"base": 40, "per_acre": 60,  "tree_cover": {"none": 1.0, "light": 1.1, "medium": 1.2, "heavy": 1.3}}',  'all',           60),
  ('pressure-washing', 'Pressure Washing', false, 1,
     '{"base": 90, "per_acre": 0,   "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.0, "heavy": 1.0}}',  'all',           70)
on conflict (slug) do nothing;

update public.services set name = 'Weekly Mowing', sort_order = 20 where slug = 'lawn-mowing';
update public.services set sort_order = 30 where slug = 'edging';
update public.services set sort_order = 80 where slug = 'leaf-removal';
update public.services set sort_order = 90 where slug = 'gutter-cleaning';
update public.services set sort_order = 100 where slug = 'snow-removal';
