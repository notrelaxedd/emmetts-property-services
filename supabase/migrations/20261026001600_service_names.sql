-- =============================================================================
-- 1600 — Customer-facing service names.
--   The fall cleanup's name shows on the quote form, in quote emails and on Stripe Checkout and
--   invoice lines. Plain words instead of "+". Only renames the row if it still has the seeded name,
--   so an owner's own edit is left alone.
-- =============================================================================
update public.services
   set name = 'Fall Lawn Cleanup (leaves, edging and gutters)'
 where slug = 'fall-cleanup'
   and name = 'Fall Lawn Cleanup (leaf removal + edging + gutters)';
