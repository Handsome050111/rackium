#!/usr/bin/env bash
# Deploys a commit (docs/DEPLOY-DEMO.md), as root: pull, install, build, take a
# backup, migrate, switch, restart, health check. A failed health check puts the
# previous release back. Each release is its own folder, so that is one link.
#   sudo rackium-deploy [git-ref]      default: DEPLOY_REF in /etc/rackium/deploy.conf
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/rackium/deploy.conf
HOME_DIR=/opt/rackium
REPO_DIR="$HOME_DIR/repo.git"
RELEASES="$HOME_DIR/releases"
KEEP_RELEASES=4
REF="${1:-$DEPLOY_REF}"
as_rackium() { sudo -u rackium env HOME="$HOME_DIR" PM2_HOME="$HOME_DIR/.pm2" PATH="/usr/bin:/bin:/usr/local/bin" "$@"; }
step() { printf '\n== %s\n' "$*"; }

exec 9>/run/lock/rackium-deploy.lock
flock -n 9 || { echo "Another deploy is running." >&2; exit 1; }

step "Pull"
[ -d "$REPO_DIR" ] || as_rackium git clone --quiet --bare "$REPO_URL" "$REPO_DIR"
as_rackium git --git-dir="$REPO_DIR" fetch --quiet --force --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
SHA="$(as_rackium git --git-dir="$REPO_DIR" rev-parse --verify "$REF^{commit}")"
RELEASE="$RELEASES/$(date -u +%Y%m%d-%H%M%S)-${SHA:0:7}"
echo "$REF is $SHA"
as_rackium mkdir -p "$RELEASE"
as_rackium git --git-dir="$REPO_DIR" archive "$SHA" | as_rackium tar -x -C "$RELEASE"
as_rackium ln -s /etc/rackium/rackium.env "$RELEASE/server/.env"

step "Install"
# Dev packages too: the build needs Vite. The test-only binaries are not fetched.
(cd "$RELEASE" && as_rackium env MONGOMS_DISABLE_POSTINSTALL=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error)

step "Build (real mode only; refused otherwise)"
(cd "$RELEASE" && as_rackium npm run --silent build:release)

PREVIOUS="$(readlink -f "$HOME_DIR/current" 2>/dev/null || true)"
if [ -n "$PREVIOUS" ]; then
  step "Backup before migrating (kept on this server)"
  /usr/local/sbin/rackium-backup --tag pre-deploy --local-only
fi

step "Migrations"
(cd "$RELEASE" && as_rackium node server/scripts/migrate.mjs)

health() {
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 http://127.0.0.1:4000/health >/dev/null 2>&1; then
      # Through Nginx too: the app's page and the API, as a browser reaches them.
      local page
      if curl -fsS --max-time 5 -k --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health" >/dev/null &&
        page="$(curl -fsS --max-time 5 -k --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/")" && [[ "$page" == *'id="root"'* ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}
switch_to() {
  as_rackium ln -sfn "$1" "$HOME_DIR/current.new"
  as_rackium mv -T "$HOME_DIR/current.new" "$HOME_DIR/current"
}
restart() {
  as_rackium pm2 delete rackium-api >/dev/null 2>&1 || true
  as_rackium pm2 start "$(readlink -f "$HOME_DIR/current")/deploy/ecosystem.config.cjs" --update-env >/dev/null
  as_rackium pm2 save --force >/dev/null
}

step "Switch and restart"
switch_to "$RELEASE"
restart

step "Health check"
if ! health; then
  echo "The new release is not healthy." >&2
  as_rackium pm2 logs rackium-api --lines 40 --nostream --err >&2 || true
  if [ -n "$PREVIOUS" ]; then
    echo "Going back to $(basename "$PREVIOUS")." >&2
    switch_to "$PREVIOUS"
    restart
    health && echo "The previous release is running again." >&2
  fi
  echo "Deploy failed. Migrations are not undone: see docs/DEPLOY-DEMO.md, Rollback." >&2
  exit 1
fi
echo "Healthy: $(basename "$RELEASE")"

# The operations commands follow the release.
for pair in deploy.sh:rackium-deploy rollback.sh:rackium-rollback backup.sh:rackium-backup restore.sh:rackium-restore; do
  install -m 0755 "$RELEASE/deploy/${pair%%:*}" "/usr/local/sbin/${pair##*:}"
done

echo "$(date -u +%FT%TZ) $(basename "$RELEASE") $REF" >>"$HOME_DIR/deploys.log"

step "Old releases (the newest $KEEP_RELEASES stay)"
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "$RELEASES/$old" = "$(readlink -f "$HOME_DIR/current")" ] || { echo "removing $old"; rm -rf "${RELEASES:?}/$old"; }
done
echo "Deployed $SHA"
