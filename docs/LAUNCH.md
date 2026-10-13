# Launch checklist

Everything below is on branch `claude/peaceful-brahmagupta-l7zdmt`; Vercel builds a preview for every push.

## 1. Wire up services (one-time)

1. **Supabase** → DONE: project `emmetts-property-services` (ref `xqeiprybuimewxkpffay`, us-east-1, free tier) exists
   with all nine migrations applied, the seed data, and the private `lead-photos` bucket. Still to do by hand:
   turn **off** public sign-ups (Authentication → Providers → Email → "Allow new users to sign up"), and in
   Authentication → URL Configuration set Site URL = `https://www.eodlawns.com` and add these redirect URLs:
   `https://www.eodlawns.com/api/auth/callback`, `https://*-notrelaxed11-3656s-projects.vercel.app/api/auth/callback`
   (previews), `http://localhost:3000/api/auth/callback`. Details: `supabase/README.md`.
2. **Vercel** → Project → Settings → Environment Variables. The form accepts a pasted `.env` block: paste the
   block below for **all environments** (Production, Preview, Development), then fill in the four secrets, then
   redeploy. (The anon key is public by design; RLS does the gating. The service-role key is not.)

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://xqeiprybuimewxkpffay.supabase.co
   SUPABASE_URL=https://xqeiprybuimewxkpffay.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxZWlwcnlidWltZXd4a3BmZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTU0NjYsImV4cCI6MjEwNzQ5MTQ2Nn0.i9IoDUlGFeJkPBju3V44pPyzZZ_sK-rDqeVZr7BGqyY
   SUPABASE_SERVICE_ROLE_KEY=            # Supabase → Project Settings → API → service_role (secret)
   ANTHROPIC_API_KEY=                    # console.anthropic.com (secret)
   ANTHROPIC_MODEL=claude-sonnet-5-5
   STRIPE_SECRET_KEY=                    # Stripe → Developers → API keys → sk_test_… (test mode)
   STRIPE_WEBHOOK_SECRET=                # after step 4 below: whsec_…
   EMAIL_PROVIDER=log
   GEOCODER=none
   PARCEL_SOURCE=none
   ```

   Also add `NEXT_PUBLIC_SITE_URL=https://www.eodlawns.com` (Production only). It is used for the pay links in
   quote emails and the Stripe redirect URLs, so it must be the `www` host, not the apex.
3. **Your owner account** → sign in once at `/login` with your email (magic link), then in Supabase SQL:
   `update public.profiles set role = 'owner' where email = '<your email>';`
4. **Stripe** (test mode). From your own machine (this needs to reach api.stripe.com):
   ```bash
   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup -- --site https://www.eodlawns.com
   ```
   It creates the webhook endpoint `https://www.eodlawns.com/api/stripe/webhook` (**must be `www`**: the apex
   `eodlawns.com` 308-redirects to it and Stripe does not follow redirects; the script corrects an apex `--site`)
   with every event the app handles, and prints the `whsec_…` **once**: paste it into Vercel as
   `STRIPE_WEBHOOK_SECRET`, then redeploy. Re-running it updates the endpoint and never prints the secret again.
   It also reports Stripe Tax and lists tax codes; leave `STRIPE_TAX_ENABLED` unset until Ohio is registered.
   Details and the manual Dashboard steps: `docs/STRIPE.md`.
   - Test it: on the endpoint page use **Send test event** → `checkout.session.completed`. Expect HTTP 200 and a
     row in `stripe_events` (it will say "no quote_id metadata" and be marked processed, which is correct).
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
