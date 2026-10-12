# Launch checklist

Everything below is on branch `claude/peaceful-brahmagupta-l7zdmt`; Vercel builds a preview for every push.

## 1. Wire up services (one-time)

1. **Supabase** → create a project (or reuse one). Apply `supabase/migrations/*.sql` in order (`supabase link` +
   `supabase db push`, or paste each file into the SQL editor). Turn **off** public sign-ups in Auth settings.
   Create the `lead-photos` bucket if the storage migration was skipped. Details: `supabase/README.md`.
2. **Vercel** → add the env vars from `docs/ENV.md` (Supabase URL + anon + service-role, `ANTHROPIC_API_KEY`,
   Stripe **test** keys, `NEXT_PUBLIC_SITE_URL`). Redeploy.
3. **Your owner account** → sign in once at `/login` with your email (magic link), then in Supabase SQL:
   `update public.profiles set role = 'owner' where email = '<your email>';`
4. **Stripe** → Developers → Webhooks → add `https://<site>/api/stripe/webhook` with the events listed in
   `docs/ENV.md`; paste the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Fleet boxes** → follow `fleet/README.md` (Node 20, `/etc/fleet/<role>.env`, `systemctl enable --now fleet-worker@quotes`, …).

## 2. What to try on the preview

- [ ] `/` and `/contact` look exactly as before (phone CTAs, sections, call bar on a phone).
- [ ] `/quote` → submit with one service + a "something else" note + 1–2 photos. Expect `/quote/thanks`.
- [ ] `/admin` (as owner): Leads shows the lead with photos; the **quotes** worker (or "Re-run quote") creates a quote and an inbox card; the custom note shows a **Custom request** card with Claude's summary + suggested range.
- [ ] On the custom card: enter your price / hours / crew → **Add my price to quote**. Or **Refer** / **Decline** (emails go out after approval; with `EMAIL_PROVIDER=log` they print to the server log).
- [ ] Quote card → **Approve** (or open the quote, tweak steppers, **Send via Stripe**). Expect the email with a `/quote/pay/<id>` link; open it → Stripe test checkout (card `4242 4242 4242 4242`).
- [ ] After paying: `/quote/paid`; the quote is **accepted**, a job appears in Schedule → "Waiting for a slot"; the **scheduler** worker (or "Run scheduler now") proposes a time and offers it to crew.
- [ ] `/admin/employees` → invite a crew member by email or phone. On a phone, open `/crew`, add it to the home screen, set weekly hours with two blocks in one day, request a day off.
- [ ] Crew: Offers → Accept. Owner: inbox shows a **Book** card → Approve → customer confirmation email; day-before reminder is queued.
- [ ] Crew: Start → Complete with actual hours. Owner: Employees shows cash owed; Money shows the job's profit; 24 h later the **followup** worker drafts a review request card.
- [ ] Crew: Drop a booked job inside 24 h → owner gets a **Drop** card; outside → scheduler finds cover.
- [ ] `/admin/autopilot`: all switches off. Turn **Follow-ups** on and watch the next reminder send itself.
- [ ] `/admin/fleet`: each box is green with CPU/RAM/temp; AI spend this month is shown here and on Money.
- [ ] `/admin/ads`: "Draft new ad" → card in inbox → Approve → "Open Ads Manager" button + copy. (v1 never auto-posts.)

## 3. Decisions still needed (left as TODO in code + UI)

| # | Question | Where it lands |
| --- | --- | --- |
| 1 | Email provider + sending domain | `EMAIL_PROVIDER`, `EMAIL_FROM` |
| 2 | Address autocomplete / geocoder | `GEOCODER` (+ key) |
| 3 | Parcel / lot-size source for Rocky River | `PARCEL_SOURCE`; until then lot acres are editable on the quote page |
| 4 | Minimum job price; drop-notice window (24 h default) | `/admin/autopilot` → Business settings |
| 5 | Partner tree service (name/email) | same page |
| 6 | Crew login by email or phone | both work; invite form has both |
| 7 | Monthly AI spend cap | same page (`ai_monthly_cap`) |

## 4. Going live (only when you say so)

- Swap Stripe test keys for live keys and re-create the webhook endpoint in live mode.
- Set `EMAIL_PROVIDER` to the real provider and verify the sending domain (SPF/DKIM).
- Merge the branch into `main`.
