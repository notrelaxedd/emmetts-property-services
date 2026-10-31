-- =============================================================================
-- 1900 canvass v3: lot-size price tiers, profit check inputs, score weights, walk length, parcel state
--
-- Pricing moves from "base price + rate per 1,000 sqft" to ONE price per service per lot-size tier
-- (small / medium / large / xl, cut by turf sqft). null = the owner has not filled it in; for xl, null
-- means "Quote on site". tier_minutes holds the crew minutes per tier per service so the owner pages can
-- show labor cost and profit (crew_size x pay_rate x minutes / 60). Crew surfaces never see those.
-- =============================================================================

alter table public.canvass_settings
  drop column base_prices,
  drop column rate_per_1000_sqft,
  drop column min_charge;   -- also drops their check constraints

alter table public.canvass_settings
  add column price_tiers   jsonb not null default '{"leaf_cleanup":{"small":30,"medium":40,"large":50,"xl":null},"mow":{"small":null,"medium":null,"large":null,"xl":null},"edge":{"small":null,"medium":null,"large":null,"xl":null},"gutters":{"small":null,"medium":null,"large":null,"xl":null},"snow":{"small":null,"medium":null,"large":null,"xl":null}}'::jsonb,
  add column tier_bounds   jsonb not null default '{"small_max":4000,"medium_max":8000,"large_max":12000}'::jsonb,
  add column tier_minutes  jsonb not null default '{"leaf_cleanup":{"small":null,"medium":null,"large":null,"xl":null},"mow":{"small":null,"medium":null,"large":null,"xl":null},"edge":{"small":null,"medium":null,"large":null,"xl":null},"gutters":{"small":null,"medium":null,"large":null,"xl":null},"snow":{"small":null,"medium":null,"large":null,"xl":null}}'::jsonb,
  add column crew_size     integer not null default 3,
  add column pay_rate      numeric(8,2) not null default 15,
  add column score_weights jsonb not null default '{"time":1,"lawn":1,"customer":1,"owner":1}'::jsonb,
  add column walk_doors    integer not null default 25,
  add constraint canvass_settings_price_tiers_obj   check (jsonb_typeof(price_tiers) = 'object'),
  add constraint canvass_settings_tier_bounds_obj   check (jsonb_typeof(tier_bounds) = 'object'),
  add constraint canvass_settings_tier_minutes_obj  check (jsonb_typeof(tier_minutes) = 'object'),
  add constraint canvass_settings_score_weights_obj check (jsonb_typeof(score_weights) = 'object'),
  add constraint canvass_settings_crew_size         check (crew_size >= 1),
  add constraint canvass_settings_pay_rate          check (pay_rate >= 0),
  add constraint canvass_settings_walk_doors        check (walk_doors between 1 and 200);

alter table public.parcels
  add column state text not null default 'OH';   -- two-letter state for the full address

comment on column public.canvass_settings.price_tiers is
  'One price per service per lot-size tier: {service:{small,medium,large,xl}}. null = owner has not filled it in (xl null = "Quote on site").';
comment on column public.canvass_settings.tier_bounds is
  'Turf sqft cut-offs: small <= small_max < medium <= medium_max < large <= large_max < xl.';
comment on column public.canvass_settings.tier_minutes is
  'Estimated crew minutes per service per tier (null = unknown). Owner-only profit check: crew_size x pay_rate x minutes / 60 against the price.';
comment on column public.canvass_settings.score_weights is
  'Multipliers on the four simple-score factors: {time,lawn,customer,owner}.';
comment on column public.canvass_settings.walk_doors is 'Doors in one Walk Mode route.';
comment on column public.parcels.state is 'Two-letter state for the full address (county pulls are Ohio).';

-- v3: canvass_settings now carries pay_rate and tier_minutes (the owner-only profit check), so the crew read
-- policy from 1800 is dropped. Walk Mode and the knock action read settings through the service role.
drop policy if exists crew_select on public.canvass_settings;
