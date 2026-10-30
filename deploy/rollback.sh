#!/usr/bin/env bash
# Goes back to an earlier release (docs/DEPLOY-DEMO.md), as root. Code only: the
# database is not touched. Migrations only add, so an earlier release runs on a
# newer database; if one must be undone, restore the pre-deploy backup as well.
#   sudo rackium-rollback            the release before the current one
#   sudo rackium-rollback --list     what can be gone back to
#   sudo rackium-rollback NAME       a named release
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/rackium/deploy.conf
HOME_DIR=/opt/rackium
RELEASES="$HOME_DIR/releases"
as_rackium() { sudo -u rackium env HOME="$HOME_DIR" PM2_HOME="$HOME_DIR/.pm2" PATH="/usr/bin:/bin:/usr/local/bin" "$@"; }

CURRENT="$(basename "$(readlink -f "$HOME_DIR/current")")"
LIST="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)"
if [ "${1:-}" = "--list" ]; then
  echo "$LIST" | sed "s/^$CURRENT$/$CURRENT  (current)/"
  exit 0
fi
TARGET="${1:-$(echo "$LIST" | grep -A1 -x "$CURRENT" | tail -n +2 | head -n 1)}"
[ -n "$TARGET" ] && [ -d "$RELEASES/$TARGET" ] || { echo "No such release to go back to: '${TARGET}'. See --list." >&2; exit 1; }

echo "From $CURRENT to $TARGET"
as_rackium ln -sfn "$RELEASES/$TARGET" "$HOME_DIR/current.new"
as_rackium mv -T "$HOME_DIR/current.new" "$HOME_DIR/current"
as_rackium pm2 delete rackium-api >/dev/null 2>&1 || true
as_rackium pm2 start "$RELEASES/$TARGET/deploy/ecosystem.config.cjs" --update-env >/dev/null
as_rackium pm2 save --force >/dev/null
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:4000/health >/dev/null 2>&1 &&
    curl -fsS --max-time 5 -k --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health" >/dev/null 2>&1; then
    echo "Healthy: $TARGET"
    echo "$(date -u +%FT%TZ) $TARGET rollback" >>"$HOME_DIR/deploys.log"
    exit 0
  fi
  sleep 2
done
echo "$TARGET is not healthy. See: sudo -u rackium env PM2_HOME=$HOME_DIR/.pm2 pm2 logs rackium-api" >&2
exit 1
