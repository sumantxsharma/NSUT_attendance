#!/bin/sh
set -e
# Apply pending migrations before starting (idempotent; each migration runs in a transaction).
if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  node apps/api/dist/db/migrate.js
fi
# Optional demo data — never enable on a live system.
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  ALLOW_PROD_SEED=yes node apps/api/dist/db/seed.js
fi
# Migrations already ran above; stop the server from repeating them.
export MIGRATE_ON_START=false
exec "$@"
