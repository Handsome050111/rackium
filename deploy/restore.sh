#!/usr/bin/env bash
# Restores a backup (docs/DEPLOY-DEMO.md), as root.
#   sudo rackium-restore --test BACKUP   into a throwaway database on port 27099:
#       decrypts, checks the sums, restores, reports. Changes nothing else.
#   sudo rackium-restore --live BACKUP --yes-replace-everything
#       replaces the live database and files. The old ones are moved aside, not
#       deleted, and the app is stopped meanwhile.
# BACKUP: a file in /var/lib/rackium/backups, or fetch it first with
#   rclone copy "$BACKUP_REMOTE/NAME" /var/lib/rackium/backups/
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
MODE="" BACKUP="" CONFIRMED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --test) MODE="test"; BACKUP="$2"; shift 2 ;;
    --live) MODE="live"; BACKUP="$2"; shift 2 ;;
    --yes-replace-everything) CONFIRMED=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODE" ] && [ -f "$BACKUP" ] || { echo "Usage: rackium-restore --test BACKUP | --live BACKUP --yes-replace-everything" >&2; exit 2; }
[ "$MODE" = test ] || [ "$CONFIRMED" = 1 ] || { echo "--live replaces everything: add --yes-replace-everything." >&2; exit 2; }

HOME_DIR=/opt/rackium
FILES_DIR="$(sed -n 's/^FILE_STORAGE_DIR=//p' /etc/rackium/rackium.env)"
as_rackium() { sudo -u rackium env HOME="$HOME_DIR" PM2_HOME="$HOME_DIR/.pm2" PATH="/usr/bin:/bin:/usr/local/bin" "$@"; }
umask 077
WORK="$(mktemp -d /var/lib/rackium/.restore.XXXXXX)"
TEMP_PORT=27099
TEMP_PID=""
cleanup() {
  [ -z "$TEMP_PID" ] || { kill "$TEMP_PID" 2>/dev/null || true; wait "$TEMP_PID" 2>/dev/null || true; }
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Decrypting $(basename "$BACKUP")"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file /etc/rackium/backup.passphrase --decrypt "$BACKUP" | tar -xf - -C "$WORK"
(cd "$WORK" && sha256sum --quiet -c SHA256SUMS)
echo "Checksums match."

# A mongod of our own, without users, on another port, only for this restore.
start_temp() { # dbpath, then any extra mongod options
  local dbpath="$1"
  shift
  mongod --quiet --port "$TEMP_PORT" --bind_ip 127.0.0.1 --dbpath "$dbpath" --logpath "$WORK/mongod.log" "$@" &
  TEMP_PID=$!
  for _ in $(seq 1 60); do mongosh --quiet --norc --port "$TEMP_PORT" --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && return 0; sleep 1; done
  echo "The temporary mongod did not start." >&2
  return 1
}
stop_temp() {
  kill "$TEMP_PID"
  wait "$TEMP_PID" 2>/dev/null || true
  TEMP_PID=""
  sleep 2
}
restore_into_temp() {
  mongorestore --quiet --port "$TEMP_PORT" --gzip --archive="$WORK/database.archive.gz" --oplogReplay --drop
}
report() { # port
  mongosh --quiet --norc --port "$1" rackium --eval '
    const names = db.getCollectionNames().sort()
    const total = names.reduce((n, c) => n + db.getCollection(c).countDocuments(), 0)
    print("Database: " + names.length + " collection(s), " + total + " document(s).")
    for (const c of ["organisations", "projects", "buildings", "devices"]) print("  " + c + ": " + db.getCollection(c).countDocuments())
  '
}

if [ "$MODE" = test ]; then
  install -d -m 0700 "$WORK/db"
  start_temp "$WORK/db"
  restore_into_temp
  report "$TEMP_PORT"
  install -d -m 0700 "$WORK/files"
  tar -xzf "$WORK/files.tar.gz" -C "$WORK/files"
  echo "Files: $(find "$WORK/files" -type f | wc -l) restored."
  echo "Restore test passed: nothing live was touched."
  exit 0
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
echo "Stopping the app and the database."
as_rackium pm2 stop rackium-api >/dev/null 2>&1 || true
systemctl stop mongod

DATA_DIR=/var/lib/mongodb
ASIDE="/var/lib/rackium/replaced-$STAMP"
install -d -m 0700 "$ASIDE"
mv "$DATA_DIR" "$ASIDE/mongodb"
install -d -o mongodb -g mongodb -m 0750 "$DATA_DIR"
install -o mongodb -g mongodb -m 0400 "$ASIDE/mongodb/rs.key" "$DATA_DIR/rs.key"

# On its own port and address, without users until the backup brings them back,
# with the app stopped. The member keeps its real name, so the normal start finds itself.
runuser -u mongodb -- mongod --port 27017 --bind_ip 127.0.0.1 --dbpath "$DATA_DIR" --replSet rs0 --logpath /var/log/mongodb/restore.log --logappend &
TEMP_PID=$!
TEMP_PORT=27017
for _ in $(seq 1 60); do mongosh --quiet --norc --port "$TEMP_PORT" --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break; sleep 1; done
mongosh --quiet --norc --port "$TEMP_PORT" --eval '
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })
  for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(1000)
  if (!db.hello().isWritablePrimary) throw new Error("no primary")
'
restore_into_temp
# The backup brought its users with the passwords of the server it came from.
# This server's settings win, so a restore onto a new server just works.
# shellcheck disable=SC1091
. /etc/rackium/mongo-admin.env
env MONGO_ADMIN_PASSWORD="$MONGO_ADMIN_PASSWORD" MONGO_APP_PASSWORD="$MONGO_APP_PASSWORD" MONGO_BACKUP_PASSWORD="$MONGO_BACKUP_PASSWORD" mongosh --quiet --norc --port "$TEMP_PORT" --eval '
  const admin = db.getSiblingDB("admin")
  admin.changeUserPassword("rackium_admin", process.env.MONGO_ADMIN_PASSWORD)
  admin.changeUserPassword("rackium_backup", process.env.MONGO_BACKUP_PASSWORD)
  db.getSiblingDB("rackium").changeUserPassword("rackium", process.env.MONGO_APP_PASSWORD)
'
stop_temp
systemctl start mongod
for _ in $(seq 1 60); do mongosh --quiet --norc --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break; sleep 1; done

mv "$FILES_DIR" "$ASIDE/files"
install -d -o rackium -g rackium -m 0750 "$(dirname "$FILES_DIR")"
tar -xzf "$WORK/files.tar.gz" -C "$(dirname "$FILES_DIR")"
chown -R rackium:rackium "$FILES_DIR"

as_rackium pm2 start rackium-api >/dev/null
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:4000/health >/dev/null 2>&1; then
    echo "Restored and healthy. The replaced data is in $ASIDE: delete it once you are sure."
    exit 0
  fi
  sleep 2
done
echo "The app is not healthy after the restore. The replaced data is in $ASIDE." >&2
exit 1
