#!/usr/bin/env bash
# Runs the migration + state-machine test on a throwaway local Postgres database.
# Connection comes from the usual PG* env vars (PGHOST, PGPORT, PGUSER, ...).
#   e.g.  PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh
set -euo pipefail
DB="truck_test_$$"
cd "$(dirname "$0")/../.."
psql -d postgres -q -c "create database $DB"
trap 'psql -d postgres -q -c "drop database $DB"' EXIT
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/local_auth_stub.sql
for f in supabase/migrations/*.sql; do psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"; done
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/state_machine.sql | grep STATE-MACHINE-OK
