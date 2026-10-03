#!/bin/sh
# Daily logical backup with retention. Run from cron/systemd timer:
#   docker compose --profile backup run --rm backup
set -eu
STAMP=$(date +%Y%m%d-%H%M%S)
DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$DIR"
FILE="$DIR/nsut_attendance-$STAMP.dump"
pg_dump --format=custom --no-owner --file="$FILE.partial"
mv "$FILE.partial" "$FILE"
# Verify the archive is readable before trusting it
pg_restore --list "$FILE" > /dev/null
sha256sum "$FILE" > "$FILE.sha256"
find "$DIR" -name 'nsut_attendance-*.dump*' -mtime +"${RETENTION_DAYS:-30}" -delete
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
