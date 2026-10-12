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
| `job_assignments` | all | own rows; may change only `status` (to accepted/declined/swap_offered/drop_requested) and `responded_at` | — | all |
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
   switch off "Allow new users to sign up". Every new auth user automatically gets a
   `crew` profile, so the app is meant to be invite-only: the owner invites crew
   from `/admin/employees` (service-role `auth.admin.inviteUserByEmail`).
2. **Make yourself the owner.** Sign in once (or invite yourself from
   Authentication → Users) so your auth user and its `crew` profile exist, then
   run this in the SQL editor:

   ```sql
   update public.profiles
      set role = 'owner'
    where user_id = (select id from auth.users where email = 'you@example.com');
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
