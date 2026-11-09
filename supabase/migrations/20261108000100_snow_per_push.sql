-- =============================================================================
-- 20261108000100 — Snow removal is per push only (no more low / medium / high monthly plans).
--   * Anyone still on a monthly tier moves to per_push at their own price, or the default per-push price.
--   * Pushes logged under a monthly plan (price null) take that per-push price, so open bills add up.
--   * New snow customers default to per_push.
-- The monthly columns on snow_settings and the enum values stay (dropping them gains nothing and
-- would break older rows); the app no longer reads or writes them. Paid snow_bills are untouched.
-- =============================================================================

update public.snow_customers sc
   set plan = 'per_push',
       per_push_price = coalesce(sc.per_push_price, s.default_per_push)
  from public.snow_settings s
 where s.id = '00000000-0000-0000-0000-000000000001'
   and (sc.plan <> 'per_push' or sc.per_push_price is null);

update public.snow_pushes p
   set price = sc.per_push_price
  from public.snow_customers sc
 where p.snow_customer_id = sc.id
   and p.price is null;

alter table public.snow_customers alter column plan set default 'per_push';
