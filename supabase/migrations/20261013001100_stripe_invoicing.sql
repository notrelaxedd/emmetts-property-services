-- =============================================================================
-- 1100 — Stripe invoicing (an alternative to the Checkout pay link).
--   customers.stripe_customer_id   Stripe Customer used for invoices (found by email or created).
--   quotes.stripe_invoice_id/url   the quote's latest invoice and, while it is the live way to pay,
--                                  its hosted invoice page.
--   settings.invoice_days_until_due default net terms for "Send as invoice".
-- Stripe Tax needs no columns: tax collected is noted in quotes.rationale and price_total stays pre-tax.
-- =============================================================================
alter table public.customers
  add column stripe_customer_id text;
-- Not unique: two customer rows (two properties) can share an email and so one Stripe customer.
create index customers_stripe_customer_idx on public.customers (stripe_customer_id) where stripe_customer_id is not null;

alter table public.quotes
  add column stripe_invoice_id  text unique,
  add column stripe_invoice_url text;

alter table public.settings
  add column invoice_days_until_due integer not null default 7,
  add constraint settings_invoice_days check (invoice_days_until_due between 1 and 365);
