#!/usr/bin/env bash
# Encrypted backup of the database and the uploaded files (docs/DEPLOY-DEMO.md),
# as root, daily by rackium-backup.timer: one file, copied off the server, kept
# for BACKUP_KEEP_DAYS (35) in both places. Exits non-zero on any failure, and
# only prunes after a backup has succeeded.
#   sudo rackium-backup                      the daily backup
#   sudo rackium-backup --tag pre-deploy --local-only   before a deploy's migrations
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/rackium/deploy.conf
TAG=daily LOCAL_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --local-only) LOCAL_ONLY=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
DIR="${BACKUP_DIR:-/var/lib/rackium/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
FILES_DIR="$(sed -n 's/^FILE_STORAGE_DIR=//p' /etc/rackium/rackium.env)"
if [ "$LOCAL_ONLY" = 0 ] && [ -z "${BACKUP_REMOTE:-}" ]; then
  echo "BACKUP_REMOTE is not set in /etc/rackium/deploy.conf: a backup must leave this server." >&2
  exit 1
fi

umask 077
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="rackium-$STAMP-$TAG.tar.gpg"
WORK="$(mktemp -d "$DIR/.work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Every database at one moment: --oplog carries what changes during the dump.
mongodump --quiet --config /etc/rackium/backup-mongo.yaml --oplog --gzip --archive="$WORK/database.archive.gz"
tar -czf "$WORK/files.tar.gz" -C "$(dirname "$FILES_DIR")" "$(basename "$FILES_DIR")"
# What restore checks: the sizes that should come back.
(cd "$WORK" && sha256sum database.archive.gz files.tar.gz >SHA256SUMS)
tar -cf - -C "$WORK" database.archive.gz files.tar.gz SHA256SUMS |
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file /etc/rackium/backup.passphrase \
    --symmetric --cipher-algo AES256 --compress-algo none --output "$WORK/$NAME"
# In place only once it is whole.
mv "$WORK/$NAME" "$DIR/$NAME"
echo "Backup written: $DIR/$NAME ($(du -h "$DIR/$NAME" | cut -f1))"

if [ "$LOCAL_ONLY" = 0 ]; then
  rclone copyto --quiet --retries 5 "$DIR/$NAME" "$BACKUP_REMOTE/$NAME"
  # Compared after the copy: a backup is off the server only when it arrived whole.
  [ "$(rclone size --json "$BACKUP_REMOTE/$NAME" | jq -r .bytes)" = "$(stat -c %s "$DIR/$NAME")" ] || {
    echo "The off-server copy of $NAME has the wrong size." >&2
    exit 1
  }
  echo "Copied off the server: $BACKUP_REMOTE/$NAME"
  rclone delete --quiet --min-age "${KEEP_DAYS}d" --include 'rackium-*.tar.gpg' "$BACKUP_REMOTE"
  date -u +%FT%TZ >"$DIR/last-success"
fi

# Rotation, here too. Pre-deploy backups are only for a deploy gone wrong: a week.
find "$DIR" -maxdepth 1 -name 'rackium-*-daily.tar.gpg' -mtime +"$KEEP_DAYS" -delete
find "$DIR" -maxdepth 1 -name 'rackium-*-pre-deploy.tar.gpg' -mtime +7 -delete
