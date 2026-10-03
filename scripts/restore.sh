#!/bin/sh
# Restore a backup produced by docker/backup.sh into the compose database.
# Usage: scripts/restore.sh /mnt/backup/nsut-attendance/nsut_attendance-YYYYMMDD-HHMMSS.dump
set -eu
DUMP="${1:?path to .dump file}"
: "${POSTGRES_USER:=nsut}" "${POSTGRES_DB:=nsut_attendance}"
[ -f "$DUMP.sha256" ] && (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
printf 'This will REPLACE database %s with %s. Type RESTORE to continue: ' "$POSTGRES_DB" "$DUMP"
read -r ok; [ "$ok" = "RESTORE" ] || { echo "aborted"; exit 1; }
docker compose stop app
docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$DUMP"
docker compose start app
echo "restored; check: curl -s http://localhost:4000/health"
