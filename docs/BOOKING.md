# Quoting, scheduling and getting paid

How a job goes from the quote form to money in the bank. The owner drives every step; nothing is
emailed to a customer and no money is asked for until the owner has spoken to them.

```
quote form ──▶ estimate ──▶ "Needs a day" rail ──▶ drag onto calendar ──▶ crew emailed ──▶ CALL the customer
                                                                                              │
                                   collect after the job ◀── crew do the job ◀── book it (cash / check / card)
```

## 1. The customer asks for a quote (`/quote`)

Name, phone, email, address, services, "something else?" + photos, preferred days. The thanks page
says **we'll call you** to go over the price and pick a day. The lead is created and the quotes worker
runs (`fleet/tasks/quote.ts`).

## 2. The system estimates (quotes worker)

Price, crew size and hours per line from `lib/pricing.ts` (`services.minutes_rule`, lot size, tree
cover). As soon as a line has a price the **job exists**: `jobs` row, `unscheduled`, `paid = false`,
`est_minutes` = sum of the lines' hours, `crew_size` = the biggest line's crew (`ensureJobForQuote`).
It shows on `/admin/schedule` in the **Needs a day** rail. A custom request still raises its
"price / refer / decline" card in the inbox; pricing it refreshes the job's estimate. No pay link, no
"approve & send" card.

## 3. The owner drags the quote onto the calendar

Drop it on a day and time (or use "Put on calendar" in the job dialog). Your open hours are checked;
the crew are not, they answer for themselves:

- the job becomes `proposed` with that slot;
- **every crew member who could work it is emailed** (`lib/ops/crew-offers.ts`): not paused or
  removed, weekly hours (minus approved time off) cover the slot, not on another job then. Someone
  who never set any hours is asked too. The email has two one-tap links, **I'm available** and
  **Can't make it**, that work without a login (`/respond/<token>`); the same offer shows in the crew
  app;
- a **"Call <customer>: <day>"** card is raised in the inbox with the phone number, the price and who
  has answered so far. It stays up until you book, unplace or cancel the job.

Answers show on the schedule block (`1/2 free`), in the job dialog and on the card. Enough yeses turn
the job `crew_confirmed`; a "can't" on a short-handed job asks the scheduler to look for cover for
the same slot. "Ask again" re-emails whoever hasn't answered. Moving the job re-asks everyone for
the new time.

## 4. The owner calls the customer

From the job dialog or the inbox card: confirm the price and the day, and ask **cash, check or
card**. Tell them you collect once the job is done. Then tick who goes (defaults to the crew who
said yes, up to the estimate's crew size; leave it empty if it's just you), pick the payment method
and **Book it**:

- chosen crew → `accepted`, every other offer withdrawn; job `booked`; `crew_size` follows the crew
  actually put on it;
- quote → `accepted` with `payment_method` (cash / check / `stripe` = card link), `accepted_at` now,
  **`paid_at` still null**; cash and check carry no card fee; lead `won`;
- the customer gets the confirmation email ("nothing to pay now, we collect by check once the job is
  done"), the day-before reminder is queued, the call card is closed.

"Back to the rail" takes a placed job off the calendar (offers withdrawn, card closed, job held so
the scheduler doesn't put it straight back). "Cancel job" on an unpaid quote marks it declined and
the lead lost.

## 5. The crew do the job

Unchanged: the crew app shows the booked job, Start / Complete, hours and photos; payouts are
written; the review request is queued.

## 6. Collect after the job

The quote page's **Payment** card says what the customer chose and shows **Collect $X** once the
job is done:

- **Cash / check**: "Record cash / check" (`recordOfflinePayment`) sets `paid_at`, marks the job
  paid, closes any Stripe link.
- **Card**: "Email card link" sends the Stripe Checkout link with an after-the-job email ("thanks
  for having us out, here's your card link"); the quote stays `accepted` and the webhook's
  `checkout.session.completed` sets `paid_at` and marks the job paid. "Send as invoice" works the same
  way for net terms.

The Money page counts revenue when `paid_at` lands. The inbox shows a strip for quotes waiting for
a day and for confirmed jobs not paid yet.

## Statuses, in one table

| Where | Value | Meaning |
| --- | --- | --- |
| `jobs.status` | `unscheduled` | estimated, on the rail ("Needs a day") |
| | `proposed` | on the calendar, crew asked, **call the customer** |
| | `crew_confirmed` | enough crew said they're free, **call the customer** |
| | `booked` | confirmed with the customer by phone |
| | `in_progress` / `done` / `cancelled` | as before |
| `quotes.status` | `draft` / `needs_owner` | estimated / a line needs your price |
| | `accepted` | the customer said yes on the phone (not paid yet unless `paid_at` is set) |
| | `sent` | legacy pay-first link out (still works) |
| `quotes.payment_method` | `cash` / `check` / `stripe` | what they said on the phone; a card payment that lands sets `stripe` |
| `quotes.paid_at` | timestamp | the money is here |
| `job_assignments.status` | `offered` / `accepted` / `declined` | no answer yet / available / can't make it (until booked; then `accepted` = on the job) |

## Settings

- `settings.auto_schedule` (default **false**): when on, the scheduler worker places new jobs by
  itself like it used to (and still emails the crew + raises the call card). Off, it only runs
  cover for short-handed jobs and the weather re-plans; "Suggest slots for everything" on the
  schedule page asks it once.
- The booking and quote autopilot switches only affect the legacy paths.
