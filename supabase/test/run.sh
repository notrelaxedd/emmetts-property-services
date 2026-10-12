#!/usr/bin/env bash
# Local DB test harness: fresh database -> auth shim -> every migration in
# order -> RLS / function tests. Exits non-zero on any failure.
#
#   npm run test:db
#   PG_URL=postgres://user:pass@host:5432 TEST_DB=ops_test npm run test:db
set -euo pipefail  # pipefail: a failing psql fails the pipe through sed

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
PG_URL="${PG_URL:-postgres://postgres:postgres@127.0.0.1:5432}"
TEST_DB="${TEST_DB:-ops_test}"

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)
TMP_A="$(mktemp)"
trap 'rm -f "$TMP_A"' EXIT

echo "==> recreating database $TEST_DB"
"${PSQL[@]}" "$PG_URL/postgres" -c "drop database if exists \"$TEST_DB\" with (force)" >/dev/null
"${PSQL[@]}" "$PG_URL/postgres" -c "create database \"$TEST_DB\"" >/dev/null

DB="$PG_URL/$TEST_DB"

echo "==> applying auth shim"
"${PSQL[@]}" "$DB" -f "$HERE/auth_shim.sql"

shopt -s nullglob
files=("$MIGRATIONS"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "no migrations found in $MIGRATIONS" >&2
  exit 1
fi
for f in "${files[@]}"; do
  echo "==> migration $(basename "$f")"
  # One transaction per file, like `supabase db push`.
  PGOPTIONS='--client-min-messages=warning' "${PSQL[@]}" --single-transaction "$DB" -f "$f"
done

echo "==> running rls.test.sql"
# Query output is discarded; results are reported as NOTICEs ("ok - ..." /
# "NOT OK - ...") and the script raises at the end if any check failed.
# Read from stdin so notices aren't prefixed with "psql:file:line:".
PGOPTIONS='--client-min-messages=notice' "${PSQL[@]}" -o /dev/null "$DB" < "$HERE/rls.test.sql" 2>&1 \
  | sed -e 's/^NOTICE:  //'

echo "==> contract check against lib/db/types.ts"
node "$HERE/contract.mjs" "$DB"

echo "==> claim_task concurrency (SKIP LOCKED)"
# Two queued followup tasks. Session A claims one and holds its transaction
# open; session B (with a short lock_timeout) must get the *other* task at
# once instead of blocking on A's row lock.
"${PSQL[@]}" "$DB" -c "delete from public.fleet_tasks where role = 'followup'" \
  -c "select public.enqueue_task('followup_review', 'followup', '{}', now(), 'conc:1')" \
  -c "select public.enqueue_task('followup_review', 'followup', '{}', now(), 'conc:2')" >/dev/null
"${PSQL[@]}" -At "$DB" \
  -c "begin" \
  -c "select dedupe_key from public.claim_task('followup', 'A')" \
  -c "select pg_sleep(3)" \
  -c "commit" >"$TMP_A" &
A_PID=$!
sleep 1
B_KEY="$("${PSQL[@]}" -At "$DB" -c "set lock_timeout = '500ms'" \
  -c "select dedupe_key from public.claim_task('followup', 'B')" | tail -n1)"
wait "$A_PID"
A_KEY="$(grep '^conc:' "$TMP_A" || true)"
if [ -n "$A_KEY" ] && [ -n "$B_KEY" ] && [ "$A_KEY" != "$B_KEY" ]; then
  echo "ok - concurrent workers claimed different tasks without blocking (A=$A_KEY, B=$B_KEY)"
else
  echo "NOT OK - concurrent claim: A='$A_KEY' B='$B_KEY'" >&2
  exit 1
fi

echo "==> all database tests passed"
