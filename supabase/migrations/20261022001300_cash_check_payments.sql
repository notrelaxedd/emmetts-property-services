-- =============================================================================
-- 1300 — Cash and check payments.
--   quotes.payment_method  how the customer paid: 'stripe' (Checkout or invoice, set by the webhook),
--                          or 'cash' / 'check' (recorded by the owner on the quote page). Null until paid.
-- A cash / check payment has no card fee (fee_total = 0) and nothing to refund through Stripe.
-- =============================================================================
alter table public.quotes
  add column payment_method text,
  add constraint quotes_payment_method check (payment_method in ('stripe', 'cash', 'check'));

-- Every quote accepted so far was paid through Stripe.
update public.quotes set payment_method = 'stripe' where accepted_at is not null;

comment on column public.quotes.payment_method is
  'How the quote was paid: stripe (Checkout / invoice), cash or check (recorded by the owner). Null until paid.';
