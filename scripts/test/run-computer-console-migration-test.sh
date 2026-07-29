#!/usr/bin/env bash
# Computer Console closeout migration apply → rollback → direct re-apply rehearsal.
# Uses only an isolated temporary PostgreSQL cluster.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/Cellar/postgresql@18/18.3/bin}"
PGPORT="${PGPORT:-54331}"
TEST_ROOT="/tmp/eshop-cc-closeout-migration-test"
PGDATA_DIR="$TEST_ROOT/pgdata"
PGSOCK="$TEST_ROOT/sock"
TEST_DB="postgresql://postgres@127.0.0.1:${PGPORT}/eshop_cc_closeout_test"
MIGRATION="$ROOT/prisma/migrations/20260730120000_add_computer_console_closeout/migration.sql"
ROLLBACK="$ROOT/prisma/migrations/20260730120000_add_computer_console_closeout/rollback.sql"

export PATH="$PGBIN:$PATH" LC_ALL=C LANG=C

cleanup() {
  pg_ctl -D "$PGDATA_DIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

rm -rf "$TEST_ROOT"
mkdir -p "$PGDATA_DIR" "$PGSOCK"
initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$PGDATA_DIR" \
  -o "-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1" \
  -l "$TEST_ROOT/postgres.log" start >/dev/null
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -q \
  -c "CREATE DATABASE eshop_cc_closeout_test;"

DATABASE_URL="$TEST_DB" DIRECT_URL="$TEST_DB" npx prisma migrate deploy >/dev/null

psql "$TEST_DB" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT to_regclass('public.\"ComputerBrowserLaunchTicket\"') IS NOT NULL,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ComputerBinding' AND column_name = 'disabledAt'
          );" | grep -qx 't|t'

psql "$TEST_DB" -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null

psql "$TEST_DB" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT to_regclass('public.\"ComputerBinding\"') IS NOT NULL,
          to_regclass('public.\"ComputerBindingAudit\"') IS NOT NULL,
          to_regclass('public.\"ComputerBrowserLaunchTicket\"') IS NULL,
          NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ComputerBinding'
              AND column_name IN ('disabledAt', 'disabledByUserId')
          );" | grep -qx 't|t|t|t'

psql "$TEST_DB" -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null

psql "$TEST_DB" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT to_regclass('public.\"ComputerBrowserLaunchTicket\"') IS NOT NULL,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ComputerBinding' AND column_name = 'disabledAt'
          );" | grep -qx 't|t'

echo "computer console migration apply/rollback/re-apply passed"
