-- =============================================================================
-- 20261118000200 — Aeration, overseeding and junk removal, plus job costs on quotes.
--
--   services            Core Aeration, Overseeding, Junk Removal. All three come to the owner to price
--                       (auto_quote = false): each one carries outside costs (aerator rental, seed,
--                       dump fees) that only the owner knows.
--   quote_items.costs   What a line costs us out of pocket, as [{ "label": "Aerator rental", "amount": 95 }].
--                       Hours-priced lines charge these at cost on top of the labor price; a line with the
--                       owner's own price already includes them. Either way they come out of take-home.
--   quotes.cost_total   Sum of the costs on billed lines (not referred / declined).
--                       take-home = price − crew pay − cost_total − card fee.
-- =============================================================================

alter table public.quote_items
  add column if not exists costs jsonb not null default '[]'::jsonb;

alter table public.quote_items
  drop constraint if exists quote_items_costs_array;
alter table public.quote_items
  add constraint quote_items_costs_array check (jsonb_typeof(costs) = 'array');

comment on column public.quote_items.costs is
  'Out-of-pocket costs for the line: [{label, amount}] (rentals, seed, dump fees). Owner-only, never sent.';

alter table public.quotes
  add column if not exists cost_total numeric(12,2) not null default 0;

alter table public.quotes
  drop constraint if exists quotes_cost_total_nonneg;
alter table public.quotes
  add constraint quotes_cost_total_nonneg check (cost_total >= 0);

comment on column public.quotes.cost_total is
  'Sum of quote_items.costs on billed lines. Comes out of take-home with crew pay and the card fee.';

insert into public.services (slug, name, auto_quote, default_crew_size, minutes_rule, seasonal, sort_order)
values
  ('aeration',     'Core Aeration', false, 1,
     '{"base": 30, "per_acre": 120, "tree_cover": {"none": 1.0, "light": 1.05, "medium": 1.1, "heavy": 1.2}}', 'all', 72),
  ('overseeding',  'Overseeding',   false, 1,
     '{"base": 20, "per_acre": 80,  "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.05, "heavy": 1.1}}', 'all', 74),
  ('junk-removal', 'Junk Removal',  false, 2,
     '{"base": 60, "per_acre": 0,   "tree_cover": {"none": 1.0, "light": 1.0, "medium": 1.0, "heavy": 1.0}}',  'all', 76)
on conflict (slug) do nothing;
