# Database (Supabase)

The schema lives in `migrations/` as plain SQL files, applied in filename order.
`lib/db/types.ts` is the TypeScript contract for it: every table, column, enum,
the `crew_jobs` view and the typed functions must match. When you change one,
change the other in the same commit, and add a **new** migration (never edit
one that has already been applied to the real project).

| File | What it does |
| --- | --- |
| `20261012000100_enums.sql` | Postgres enum types (`role`, `job_status`, `fleet_role`, …) |
| `20261012000200_tables.sql` | All 22 tables, FKs, indexes, check constraints, `set_updated_at()` trigger |
| `20261012000300_functions.sql` | `current_role()`, `is_owner()`, `current_profile_id()`, `ai_spend_this_month()`, task queue (`enqueue_task`, `claim_task`, `complete_task`, `fail_task`, `requeue_stale_tasks`), guard triggers, `auth.users` → `profiles` hook |
| `20261012000400_views.sql` | `crew_jobs`: the crew-safe view of jobs (no prices, no customer phone/email) |
| `20261012000500_rls.sql` | Row-level security on every table |
| `20261012000600_seed.sql` | `settings` row, `services` catalogue, owner windows Mon–Sat 09:00–18:00 |
| `20261012000700_storage.sql` | Private `lead-photos` bucket + owner-read policy (skipped when there's no `storage` schema) |

## Who can see what

| | Owner | Crew | Anonymous | Service role |
| --- | --- | --- | --- | --- |
| Every table | read + write | — | nothing | bypasses RLS |
| `profiles` | all | own row; may change only `name`, `phone`, `max_hours_week`, `paused` | — | all |
| `crew_availability`, `crew_exceptions` | all | own rows (read/insert/update/delete); time-off `status` is always forced to `pending` | — | all |
| `job_assignments` | all | own rows; may change only `status` + `responded_at`, and only `offered→accepted`, `offered→declined`, `accepted→drop_requested` (swaps and drops go through server actions using the service role) | — | all |
| `payouts` | all | own rows, read only | — | all |
| `services` | all | read | — | all |
| `crew_jobs` view | every job | jobs they are assigned to | — | every job |
| quotes, quote_items, customers, leads, jobs, settings, approvals, ads, messages, expenses, ai_usage, fleet_*, stripe_events, owner_* | all | **nothing** | — | all |

The public quote form writes through a server action that uses the service-role
key; fleet workers use the service-role key too. The queue functions
(`claim_task`, `complete_task`, `fail_task`, `requeue_stale_tasks`) can only be
called by the service role; `enqueue_task` and `ai_spend_this_month` by the
service role or the owner.

## Applying the migrations to the real project

**Option A: Supabase CLI**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # Dashboard → Project Settings → General
npx supabase db push                                 # applies every migration not yet applied
```

If the CLI says the project isn't initialised, run `npx supabase init` first. It
only adds `supabase/config.toml` and leaves `migrations/` alone.

**Option B: SQL editor.** In Dashboard → SQL Editor, paste and run each file in
`migrations/` **in filename order**, one at a time. Don't paste anything from
`test/`. The auth shim is only for local Postgres.

After applying:

1. **Turn off public sign-ups.** Go to Authentication → Sign In / Providers and
   switch off "Allow new users to sign up". The app is invite-only: the owner
   invites crew from `/admin/employees`. The `auth.users` hook
   (`handle_new_user`, see `20261012000800_guards.sql`) creates a `crew` profile
   **only for invited users**:
   - email invites (`auth.admin.inviteUserByEmail`, or Dashboard →
     Authentication → Users → **Invite user**): Supabase sets `invited_at`;
   - phone crew added from `/admin/employees` (`auth.admin.createUser` with
     `phone_confirm: true` and `user_metadata: { name }`): phone already
     confirmed when the user is created, and `name` in the metadata.

   Any other new auth user (a public sign-up left on by mistake, Dashboard
   **Add user → Create new user**) gets **no profile**, so it can't see anything.
2. **Make yourself the owner.** Easiest: Dashboard → Authentication → Users →
   **Invite user** with your own email, accept the invite once (this creates
   your auth user and its `crew` profile), then run this in the SQL editor. It
   also works if your auth user has no profile yet (e.g. you created it with
   **Add user**), because it inserts the row when it's missing:

   ```sql
   insert into public.profiles (user_id, role, name, email)
   select id, 'owner', coalesce(raw_user_meta_data ->> 'name', split_part(email, '@', 1)), email
     from auth.users
    where email = 'you@example.com'
   on conflict (user_id) do update set role = 'owner';
   ```

   The role is never taken from user metadata, and crew can't change their own
   role, so this step, or another owner, is the only way to get an owner.
3. Check `settings` and fill in the `TODO` values once they're decided:
   `ai_monthly_cap` [CAP $], `min_job_price` [MIN PRICE], `partner_tree_service_*`,
   `base_lat` / `base_lng`.
4. Expect the Supabase security advisor to flag `crew_jobs` as a "security
   definer view". That's intended: the view reads tables crew can't select, and it
   filters rows itself (owner: all; crew: only jobs they're assigned to; anon:
   nothing).

## Auth emails (invite, sign-in link, password reset, …)

Supabase sends the crew invite, magic-link, password-reset and change-email emails itself. The branded
versions live in `templates/`, one HTML file per email, styled like the app's own customer emails:

| File | Dashboard template | Subject |
| --- | --- | --- |
| `invite.html` | Invite user | You're invited to the Emmett's crew app |
| `magic_link.html` | Magic link | Your sign-in link for Emmett's Property Services |
| `recovery.html` | Reset password | Reset your Emmett's Property Services password |
| `email_change.html` | Change email address | Confirm your new email address |
| `confirmation.html` | Confirm sign up | Confirm your email address (sign-ups are off, so rarely sent) |
| `reauthentication.html` | Reauthentication | `{{ .Token }} is your verification code` |
| `password_changed_notification.html` | Password changed (security notification) | Your Emmett's Property Services password was changed |

The subjects and the file list are in `lib/auth/email-templates.ts`; `npm test` checks every template has the
variables it needs (`{{ .ConfirmationURL }}`, `{{ .Token }}`, …). Links use `{{ .ConfirmationURL }}`, so the
existing `/api/auth/callback` → `/auth/finish` flow and the redirect-URL allow list work unchanged.

**Apply them to the hosted project** (re-run after editing a template):

```bash
SUPABASE_ACCESS_TOKEN=sbp_… npm run supabase:emails -- --project-ref xqeiprybuimewxkpffay
npm run supabase:emails -- --dry-run     # check the templates without calling the API
```

The token is a personal access token from <https://supabase.com/dashboard/account/tokens> (not the
service-role key); don't put it in Vercel or `.env.local`. The script sets every subject and body and turns on
the "password changed" notification. **Or by hand:** Dashboard → Authentication → Emails → Templates, pick each
template, paste the subject from the table and the whole HTML file, and save; for the password-changed email,
also switch the notification on.

Auth emails go out through Resend's SMTP (Authentication → Emails → SMTP Settings); the templates don't
depend on it. Keep **click tracking off** for the sending domain in Resend (Domains → the domain →
Configuration): it rewrites the sign-in links and breaks them. Supabase still caps auth emails per hour under
Authentication → Rate Limits; raise it there if invites or sign-in links stop arriving.

## Local test harness

`npm run test:db` runs `test/run.sh`, which:

1. drops and recreates the database `ops_test` on local Postgres
   (default `postgres://postgres:postgres@127.0.0.1:5432`; override with
   `PG_URL=postgres://user:pass@host:port` and `TEST_DB=name`);
2. applies `test/auth_shim.sql`, a minimal stand-in for Supabase's `auth`
   schema (`auth.users`, `auth.uid()`, `auth.role()`, `auth.jwt()`) and the
   `anon` / `authenticated` / `service_role` roles with Supabase-style grants;
3. applies every migration in order, each in a single transaction (the storage
   migration skips itself because there is no `storage` schema);
4. runs `test/rls.test.sql`, which covers RLS for anon, crew and owner, the guard
   triggers, the task queue, the seeds and the constraints. Users are simulated the
   way PostgREST does it:

   ```sql
   set role authenticated;
   set request.jwt.claims = '{"sub":"<auth user uuid>","role":"authenticated"}';
   ```
5. runs `test/contract.mjs`, which compares the database with `lib/db/types.ts`:
   enum labels, the exact column set and nullability of each table, the
   `crew_jobs` columns, and function argument names;
6. checks that two workers calling `claim_task` at the same time get different
   tasks without blocking (`FOR UPDATE SKIP LOCKED`).

Any failed check makes the script exit non-zero. Requires `psql` and Node ≥ 20.

## Notes for app and worker code

- `crew_id` columns reference `profiles.id`, **not** `auth.users.id`. Use
  `current_profile_id()` (SQL) or look up the profile by `user_id`.
- Clock times are `"HH:MM"` text (`"09:00"`), weekdays are `0..6` with 0 = Sunday,
  and dates are `"YYYY-MM-DD"`.
- `current_role` is an SQL keyword. In SQL, call it as `public.current_role()`.
  From supabase-js, `rpc('current_role')` works as normal.
- `fail_task(p_id, p_error, p_retry_in)` requeues with `p_retry_in` (or
  30s·2^(attempts−1) when null) until `max_attempts`, then marks the task
  `failed`. It returns the new status.
- `ai_spend_this_month()` counts the calendar month in `America/New_York`.
- Crew can't write `jobs`. Start/Complete/actual hours from the crew app must go
  through a server action using the service role, after checking the caller has
  an accepted assignment on that job.
- `payouts` rows block deleting a crew member's profile (`on delete restrict`)
  so pay history isn't lost. Pause crew instead of deleting them.

## Note on the storage migration (0700)

On the hosted project, `storage.objects` is owned by `supabase_storage_admin`, and the migration tool timed out
running the `do $$ … $$` block. The bucket insert and the two policies were applied as three separate plain
statements instead (same SQL, no DO block), and the migration was recorded by hand in
`supabase_migrations.schema_migrations` as `20261012000700_storage` so `supabase db push` won't try to re-run it.
If you ever recreate the project, apply 0700 the same way: run the `insert into storage.buckets …`, then each
`create policy … on storage.objects` on its own.
