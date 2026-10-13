# Stripe: payments, invoices, sales tax

Everything runs in Stripe **test mode** until the owner approves going live. Going live is a key swap plus the
checklist below. There is no live-mode switch in the app.

| Piece | File |
| --- | --- |
| Client (warns on a non-test key) | `lib/stripe/client.ts` |
| Checkout session, shared `billedLines`, revise, refund | `lib/stripe/checkout.ts` |
| Invoices (`createInvoiceForQuote`, `voidInvoiceForQuote`) | `lib/stripe/invoice.ts` |
| Tax flags, address parsing | `lib/stripe/tax.ts` |
| Webhook processing | `lib/stripe/webhook.ts`, route `app/api/stripe/webhook/route.ts` |
| Durable pay link | `app/(marketing)/quote/pay/[id]/route.ts` |
| Sending a quote (approval side effect) | `lib/ops/handlers/quote.ts` |
| Admin buttons | `app/admin/actions/quotes.ts`, `components/admin/quotes/quote-editor.tsx` |
| Account setup script | `scripts/stripe-setup.ts` (helpers `lib/stripe/setup.ts`) |

Tests mock the `stripe` SDK (`lib/stripe/*.test.ts`); nothing in CI talks to Stripe.

## 1. Payments (Checkout)

The default way to send a quote: **Send via Stripe** on the quote page, or approving a quote card in the inbox.

1. The quote handler creates a Checkout Session (one line per billed item, plus a "Minimum job adjustment" line
   when the minimum price applies; an owner-lowered total scales the lines down so the customer pays exactly
   `price_total`).
2. The email links to **`/quote/pay/<quote id>`**, not the Checkout URL. Stripe sessions live 24 h at most; quotes
   live `quote_valid_days`. Each click reuses the open session or mints a new one while the quote is `sent` and
   not expired. A paid quote goes to `/quote/paid`; a draft / expired / declined one to `/quote/expired`.
3. Changing the items or total creates a new session and expires the old one (sessions carry an `items_hash`),
   so only one link can be paid. **Revise & re-send** expires the open session and returns the quote to draft.
   It refuses if the customer already paid.

**Webhook idempotency.** Every event is stored in `stripe_events` (unique `stripe_event_id`) before it is
processed and marked `processed_at` after. A redelivered event that already finished is a no-op. One that failed
half-way is retried (the route answers 500 so Stripe redelivers). The accept path is safe to repeat: job
creation and the `schedule` task are de-duplicated.

**Amount verification.** On payment the quote is accepted no matter what, because the money has arrived. The
amount is checked against `price_total`: the **pre-tax subtotal** (`amount_subtotal`) when Stripe Tax ran on
the session, otherwise `amount_total`. A difference adds a WARNING note to the quote and an inbox card. A
second, different payment for an already-paid quote is never attached: the first stays (refunds and the job
hang off it), and the owner gets a "refund manually" note and card.

**Refunds.** The **Refund** button refunds the stored PaymentIntent in full (tax included), cancels the job
(refused if it is already done) and declines the quote. `charge.refunded` adds a note.

## 2. Invoicing

**When to use it:** repeat or recurring customers, anyone who pays on terms ("net 15"), people who want to pay by
bank transfer, or anyone who wants a proper invoice for their records. For a one-off customer paying now,
Checkout is simpler.

**Sending.** On the quote page, use **Send as invoice**, pick the days until due (default
`settings.invoice_days_until_due`, 7, editable under Autopilot → Business settings) and confirm. This:

- finds the Stripe Customer by email or creates one (name, email, phone, address), saved in
  `customers.stripe_customer_id`;
- creates a `send_invoice` invoice with `days_until_due`, one item per billed line (same `billedLines` as
  Checkout), finalizes it, and has **Stripe email it**. We send no email ourselves; a `messages` row (kind
  `quote`, status `sent`, body = hosted invoice URL) keeps the customer's log complete;
- stores `stripe_invoice_id` / `stripe_invoice_url` on the quote and marks it `sent`. `expires_at` is cleared
  because the invoice has its own due date and Stripe sends reminders, so the host worker never expires an
  invoiced quote.

**One way to pay at a time.** Sending an invoice expires any open Checkout session (refused if it was already
paid). Sending a Checkout link voids the open invoice first. The old emailed `/quote/pay/<id>` link redirects
to the hosted invoice while one is live. **Revise & re-send** voids the invoice too.

**Idempotent.** Re-sending with the same lines and terms reuses the open invoice and asks Stripe to email it
again. Different lines or terms void it and create a new one. A leftover draft from a crash is deleted.

**Webhook.**

| Event | What happens |
| --- | --- |
| `invoice.paid` | Same accept path as Checkout: quote `accepted`, `stripe_payment_intent_id` set (read from the invoice's payments; falls back to the legacy `invoice.payment_intent`), lead `won`, job created + `schedule` task. Same amount and second-payment checks. An invoice marked paid outside Stripe is accepted without a PaymentIntent, so it can't be refunded from the app. |
| `invoice.payment_failed` | Note on the quote. Stripe emails the customer and retries according to its settings. |
| `invoice.voided` | If the owner voided the live invoice in Stripe: note, and the quote goes `sent` → `declined`. Voids made by the app (re-send, revise, switch to Checkout) are ignored. |
| `invoice.marked_uncollectible` | Note only. Stripe still accepts payment on it, and a later `invoice.paid` still accepts the quote. |

**Refunds** work the same as Checkout (refund via the PaymentIntent). Stripe leaves the invoice marked `paid`;
issue a credit note in the Dashboard if the customer needs the paperwork.

## 3. Sales tax (Stripe Tax, Ohio)

Ohio taxes landscaping and lawn care services, and Emmett's works in Rocky River (Cuyahoga County), so sales tax
applies to most jobs. Confirm with your accountant which services count, snow removal and one-off jobs
included.

**Owner steps (once):**

1. Get an Ohio **service vendor's license** from the Ohio Department of Taxation (through the Ohio Business
   Gateway) if you don't already have one.
2. Stripe Dashboard → **Tax** → Settings: head office address (Rocky River), a default tax code, and default
   tax behavior **exclusive** (prices exclude tax).
3. Tax → **Registrations** → Add registration → United States → **Ohio**, with your license details and start
   date.
4. Run `npm run stripe:setup` (below): it confirms Stripe Tax is active, Ohio is registered, and lists candidate
   tax codes. Pick the code that matches the service and set `STRIPE_TAX_CODE` in Vercel, or leave it unset to
   use the account default from step 2. **Do not guess a code.**
5. Set `STRIPE_TAX_ENABLED=true` in Vercel (and on the quotes box if quote autopilot is on) and redeploy.

**Env flags.**

| Variable | Effect |
| --- | --- |
| `STRIPE_TAX_ENABLED` | `true` → new Checkout sessions get `automatic_tax` and `billing_address_collection: required` (Stripe needs an address to compute tax); new invoices get `automatic_tax`. Unset (default) → no tax collected. |
| `STRIPE_TAX_CODE` | `txcd_…` on every line (`product_data.tax_code` / invoice item `tax_code`). Unset → omitted, so the account default applies. |

Every line is sent with `tax_behavior: "exclusive"` either way. Flipping either flag starts a new Checkout
session for open quotes on the next pay-link click.

**How tax shows up.**

- Checkout asks for the billing address and shows the tax line before payment. Invoices show tax under the
  subtotal. Invoicing with tax on needs the customer's ZIP code, so the address must read like
  `19000 Lake Rd, Rocky River, OH 44116`; sending refuses with a clear message otherwise.
- `quotes.price_total` stays the **pre-tax** price. On payment a note is appended to the quote:
  `Sales tax collected: $6.40 (checkout cs_…)` / `(invoice in_…)`. It shows in the quote's Notes card.
- Quote emails say "plus Ohio sales tax (calculated at checkout)" when tax is on.
- Revenue figures in the app are pre-tax. Stripe's Tax reports (Dashboard → Tax → Reports) are the source for
  filing.
- Refunds return the tax too.

One tax code covers every line. If you start selling a mix of taxable and non-taxable services, the code would
need to move to the service catalogue (not built).

## 4. Going live checklist

Only after the owner says go.

- [ ] Stripe account activated (business details, bank account for payouts).
- [ ] Live keys: Vercel `STRIPE_SECRET_KEY=sk_live_…` (Production only; keep `sk_test_` on Preview). Also on the
      quotes fleet box if quote autopilot is on. The app logs a warning on a non-test key. That is expected
      once live.
- [ ] Live webhook: `STRIPE_SECRET_KEY=sk_live_… npm run stripe:setup -- --site https://www.eodlawns.com --live`
      then put the new live `whsec_…` in Vercel `STRIPE_WEBHOOK_SECRET` (test and live endpoints have different
      secrets) and redeploy. Send a test event; expect HTTP 200 and a `stripe_events` row.
- [ ] Domain: `NEXT_PUBLIC_SITE_URL=https://www.eodlawns.com` and the webhook on **`www`**. The apex 308-redirects
      and Stripe does not follow redirects.
- [ ] Stripe Tax in **live** mode: settings, Ohio registration and default code are per mode. Re-run the setup
      script with `--live` to check, then set `STRIPE_TAX_ENABLED` / `STRIPE_TAX_CODE` for Production.
- [ ] Invoice emails: Dashboard → Settings → Billing → Invoices (branding, reminder schedule, payment methods on
      the hosted page) and Settings → Emails → "Email customers about successful payments".
- [ ] One real low-value payment end to end (Checkout and invoice), then refund it from the app.

## 5. What the setup script does

```bash
STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --site https://www.eodlawns.com
# same as: STRIPE_SECRET_KEY=sk_test_… npx tsx scripts/stripe-setup.ts --site https://www.eodlawns.com
```

Run it on your own machine. It reads nothing from the database and never prints the key.

1. **Refuses a live key** (`sk_live_` / `rk_live_`) unless `--live` is passed, and anything that isn't a secret or
   restricted key.
2. **Normalises `--site`**: https, no path, and `www` for the bare apex (with a warning that `eodlawns.com`
   308-redirects and Stripe doesn't follow redirects). A localhost site gets a pointer to `stripe listen`.
3. **Webhook endpoint** at `<site>/api/stripe/webhook`: lists your endpoints, creates one if none matches (pinned
   to the SDK's API version) or updates the events / re-enables the existing one. The signing secret is printed
   **only when the endpoint is created**, with "paste into Vercel as STRIPE_WEBHOOK_SECRET". Stripe never shows it
   again through the API; to recover it, reveal or roll it in Dashboard → Developers → Webhooks. It also warns
   about other endpoints pointing at this app (e.g. a stale apex one). Events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
   `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`.
4. **Stripe Tax**: prints whether it is active and the default tax code / behavior, lists US registrations, and
   warns if Ohio (US-OH) is missing.
5. **Tax codes**: pages through all tax codes and prints the id + name of each one matching
   landscaping / lawn / garden / snow, so you can choose `STRIPE_TAX_CODE`.

Safe to re-run. Local development still uses `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Testing in test mode

- Card `4242 4242 4242 4242`, any future date, any CVC. A Rocky River billing address (ZIP 44116) shows Ohio tax
  once it is enabled.
- An invoice in test mode: open the hosted invoice link from the quote page and pay it with the same card.
- `stripe trigger invoice.payment_failed` and similar commands exercise the handlers, but they carry no
  `quote_id` metadata, so they are recorded and ignored.
