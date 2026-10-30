#!/usr/bin/env bash
# The whole runbook (docs/DEPLOY-DEMO.md) on a clean Ubuntu 24.04, run by CI
# (.github/workflows/deploy-smoke.yml) from a checkout, as root: setup, deploy,
# what a browser and an attacker see, seed, testers, backup, a restore test, a
# live restore, a failed deploy going back by itself, and a rollback. Only a
# self-signed certificate and a local "off-server" folder differ from the real thing.
set -euo pipefail

CHECKOUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN=rackium.test
SRC=/opt/smoke-src.git
OFFSITE=/opt/smoke-offsite
BACKUPS=/var/lib/rackium/backups
ok() { printf 'ok   %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
step() { printf '\n=== %s\n' "$*"; }
web() { curl -sS --max-time 15 -k --resolve "$DOMAIN:443:127.0.0.1" --resolve "$DOMAIN:80:127.0.0.1" "$@"; }
mongo_admin() {
  # shellcheck disable=SC1091
  . /etc/rackium/mongo-admin.env
  mongosh --quiet --norc "mongodb://127.0.0.1:27017/rackium?replicaSet=rs0&authSource=admin" -u rackium_admin -p "$MONGO_ADMIN_PASSWORD" --eval "$1"
}
as_rackium() { sudo -u rackium env HOME=/opt/rackium PM2_HOME=/opt/rackium/.pm2 PATH="/usr/bin:/bin:/usr/local/bin" "$@"; }

step "The kernel check"
for good in 6.8.0-88-generic 6.17.0-5-azure 6.18.9 7.0.14-azure 7.1.0; do
  bash "$CHECKOUT/deploy/check-kernel.sh" "$good" 2>/dev/null || fail "kernel $good was refused"
done
for bad in 6.19.0 6.19.3-azure 7.0.0-1009-azure 7.0.13-generic; do
  if bash "$CHECKOUT/deploy/check-kernel.sh" "$bad" 2>/dev/null; then fail "kernel $bad was accepted"; fi
done
ok "kernels 6.19 to 7.0.13 are refused, others accepted"
KERNEL="$(uname -r)"
echo "This runner: $KERNEL"
ACCEPT_KERNEL=()
if ! bash "$CHECKOUT/deploy/check-kernel.sh" 2>/dev/null; then
  if "$CHECKOUT/deploy/setup-ubuntu.sh" --domain "$DOMAIN" --repo /nowhere --self-signed >/dev/null 2>&1; then fail "setup ran on a refused kernel"; fi
  [ ! -d /opt/rackium ] || fail "setup installed something before refusing the kernel"
  ok "setup refuses this kernel before installing anything"
  # CI only, and not MongoDB's documented way: this runner's kernel cannot be
  # changed. A real server runs a kernel MongoDB accepts (the check above).
  mkdir -p /etc/systemd/system/mongod.service.d
  printf '[Service]\nEnvironment=GLIBC_TUNABLES=glibc.pthread.rseq=1\n' >/etc/systemd/system/mongod.service.d/ci-kernel.conf
  export GLIBC_TUNABLES=glibc.pthread.rseq=1
  ACCEPT_KERNEL=(--accept-kernel)
fi

step "Setup"
# CI only: this root user also works in folders owned by others.
git config --global --add safe.directory "*"
git clone --quiet --bare "$CHECKOUT" "$SRC"
git --git-dir="$SRC" update-ref refs/heads/smoke "$(git -C "$CHECKOUT" rev-parse HEAD)"
"$CHECKOUT/deploy/setup-ubuntu.sh" --domain "$DOMAIN" --repo "$SRC" --self-signed "${ACCEPT_KERNEL[@]}"
chown -R rackium:rackium "$SRC"
"$CHECKOUT/deploy/setup-ubuntu.sh" --domain "$DOMAIN" --repo "$SRC" --self-signed "${ACCEPT_KERNEL[@]}" >/dev/null
ok "setup runs twice"
FIRST_JWT="$(grep -c JWT_SECRET /etc/rackium/rackium.env)"
[ "$FIRST_JWT" = 1 ] || fail "env file"
[ "$(stat -c %a /etc/rackium/rackium.env)" = 640 ] || fail "env file mode"
[ "$(stat -c %a /etc/rackium/mongo-admin.env)" = 600 ] || fail "mongo secrets mode"
[ "$(stat -c %a /etc/rackium/backup.passphrase)" = 600 ] || fail "passphrase mode"
ok "secrets are private"

step "Refused until configured"
if rackium-deploy smoke; then fail "deploy with the placeholder Resend key should fail"; fi
ok "a deploy with the placeholder key is refused"
sed -i 's/^RESEND_API_KEY=.*/RESEND_API_KEY=re_ci_not_a_real_key/' /etc/rackium/rackium.env
sed -i "s|^BACKUP_REMOTE=.*|BACKUP_REMOTE=$OFFSITE|" /etc/rackium/deploy.conf
sed -i 's/^DEPLOY_REF=.*/DEPLOY_REF=smoke/' /etc/rackium/deploy.conf
install -d -m 0700 "$OFFSITE"

step "Deploy"
rackium-deploy
FIRST_RELEASE="$(basename "$(readlink -f /opt/rackium/current)")"
ok "deployed $FIRST_RELEASE"

step "What is listening, and the process"
ss -ltn | grep -q '127.0.0.1:27017' || fail "mongod is not on localhost"
if ss -ltn | grep -E ':27017' | grep -qv '127.0.0.1'; then fail "mongod is listening beyond localhost"; fi
if ss -ltn | grep -E ':4000' | grep -qvE '(\*|0\.0\.0\.0|\[::\]):4000'; then :; fi
ok "mongod on localhost only"
ufw status | grep -E '^(22|80|443)/tcp' >/dev/null || fail "firewall rules"
if ufw status | grep -E 'ALLOW' | grep -vE '^(22|80|443)/tcp' | grep -q .; then fail "a port other than 22, 80, 443 is open"; fi
ok "firewall: 22, 80, 443 only"
PM2="$(as_rackium pm2 jlist)"
[ "$(echo "$PM2" | jq '[.[] | select(.name=="rackium-api")] | length')" = 1 ] || fail "not exactly one process"
[ "$(echo "$PM2" | jq -r '.[] | select(.name=="rackium-api") | .pm2_env.exec_mode')" = fork_mode ] || fail "not fork mode"
ok "one PM2 process, fork mode"
mongosh --quiet --norc --eval 'db.getSiblingDB("rackium").getCollectionNames()' >/dev/null 2>&1 && fail "the database answers without a user" || ok "the database refuses without a user"

step "What a browser sees"
[ "$(web -o /dev/null -w '%{http_code}' "http://$DOMAIN/some/page")" = 301 ] || fail "http is not redirected"
web -o /dev/null -w '%{redirect_url}' "http://$DOMAIN/some/page" | grep -q "https://$DOMAIN/some/page" || fail "redirect target"
ok "http redirects to https"
HEADERS="$(web -D - -o /dev/null -H 'Accept-Encoding: gzip' "https://$DOMAIN/orgs/x/projects")"
for h in 'content-security-policy:' 'x-content-type-options: nosniff' 'x-frame-options: DENY' 'strict-transport-security:' 'referrer-policy:' 'permissions-policy:' 'cache-control: no-cache'; do
  echo "$HEADERS" | grep -qi "^$h" || fail "header missing: $h"
done
ok "security headers on the app's pages"
web "https://$DOMAIN/orgs/x/projects" | grep -q 'id="root"' || fail "SPA routing"
ok "SPA routing"
ASSET="$(web "https://$DOMAIN/" | grep -o '/assets/[^"]*\.js' | head -n 1)"
ASSET_HEADERS="$(web -D - -o /dev/null -H 'Accept-Encoding: gzip' "https://$DOMAIN$ASSET")"
echo "$ASSET_HEADERS" | grep -qi '^content-encoding: gzip' || fail "assets are not gzipped"
echo "$ASSET_HEADERS" | grep -qi '^cache-control:.*immutable' || fail "assets are not cached"
echo "$ASSET_HEADERS" | grep -qi '^content-security-policy:' || fail "assets lost the security headers"
ok "assets: gzip, long cache, headers"
[ "$(web "https://$DOMAIN/health")" = '{"status":"ok","app":"up","database":"up"}' ] || fail "/health"
[ "$(web "https://$DOMAIN/api/v1/health")" = '{"status":"ok","app":"up","database":"up"}' ] || fail "/api/v1/health"
ok "health, nothing else in it"
[ "$(web -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/v1/openapi.json")" = 404 ] || fail "the API map is public"
web "https://$DOMAIN/api/v1/client-config" | jq -e '.banner == "Test environment — do not enter real customer data" and .signupEnabled == false' >/dev/null || fail "client config"
[ "$(web -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"organisationName":"X","name":"X","email":"x@example.com","password":"correct horse battery"}' "https://$DOMAIN/api/v1/auth/signup")" = 403 ] || fail "sign-up is open"
ok "sign-up closed, API map hidden, banner set"
[ "$(web -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary @<(head -c 9000000 /dev/zero | tr '\0' 'a') "https://$DOMAIN/api/v1/auth/login")" = 413 ] || fail "Nginx let 9 MB through"
ok "upload limit"
# X-Forwarded-For from the client is replaced: login limits count the real address.
for _ in $(seq 1 11); do
  LAST="$(web -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.8.$RANDOM" -d '{"email":"nobody@example.com","password":"wrong wrong wrong"}' "https://$DOMAIN/api/v1/auth/login")"
done
[ "$LAST" = 429 ] || fail "a forged X-Forwarded-For got round the sign-in limit (last status $LAST)"
ok "a forged X-Forwarded-For does not get round the sign-in limit"
as_rackium pm2 restart rackium-api >/dev/null
for _ in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:4000/health >/dev/null 2>&1 && break; sleep 2; done

step "Seed: the demo project, with a generated password, PDFs through Chrome"
(cd /opt/rackium/current && as_rackium node server/scripts/seed-test-server.mjs)
[ "$(stat -c %a /opt/rackium/demo-logins.txt)" = 600 ] || fail "demo logins mode"
DEMO_PASSWORD="$(sed -n 's/^Password for every user: //p' /opt/rackium/demo-logins.txt)"
[ -n "$DEMO_PASSWORD" ] && [ "$DEMO_PASSWORD" != rackium-demo-2026 ] || fail "the demo password"
if (cd /opt/rackium/current && as_rackium node server/scripts/seed-test-server.mjs >/dev/null 2>&1); then fail "the seed ran twice"; fi
ok "seed once, refused twice, its own password"
STATUS="$(web -o /tmp/login.json -w '%{http_code}' -c /tmp/cookies -X POST -H 'Content-Type: application/json' -d "$(jq -n --arg p "$DEMO_PASSWORD" '{email:"org-admin@example.com",password:$p}')" "https://$DOMAIN/api/v1/auth/login")"
[ "$STATUS" = 200 ] || fail "demo sign-in: $STATUS"
grep -q 'Secure' /tmp/cookies || grep -qE '\sTRUE\s' /tmp/cookies || fail "the session cookie is not Secure"
ok "demo sign-in through Nginx, cookie Secure"
[ "$(web -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"email":"org-admin@example.com","password":"rackium-demo-2026"}' "https://$DOMAIN/api/v1/auth/login")" != 200 ] || fail "the repo's demo password works here"
mongo_admin 'const d = db.generateddocuments.countDocuments({ status: "ready" }); if (d < 12) throw new Error("only " + d + " documents"); print(d + " documents rendered")'
ok "documents rendered with Chrome"

step "Testers: the list checked whole, invited once"
cat >/tmp/testers.csv <<'EOF'
name,email,role
Ana Tester,ana@example.org,architect
Fred Field,fred@example.org,Field Engineer
EOF
chown rackium /tmp/testers.csv
(cd /opt/rackium/current && as_rackium node server/scripts/invite-testers.mjs --file /tmp/testers.csv)
(cd /opt/rackium/current && as_rackium node server/scripts/invite-testers.mjs --file /tmp/testers.csv) | grep -q 'invitation_pending' || fail "testers invited twice"
echo 'Bad,not-an-email,viewer' >/tmp/bad.csv
chown rackium /tmp/bad.csv
if (cd /opt/rackium/current && as_rackium node server/scripts/invite-testers.mjs --file /tmp/bad.csv >/dev/null 2>&1); then fail "a bad list was accepted"; fi
ok "testers"

step "Backup: encrypted, off the server, rotated"
as_rackium sh -c 'echo uploaded-file-marker > /var/lib/rackium/files/smoke-marker'
touch -d '40 days ago' "$BACKUPS/rackium-20200101-000000-daily.tar.gpg"
touch -d '40 days ago' "$OFFSITE/rackium-20200101-000000-daily.tar.gpg"
touch -d '10 days ago' "$BACKUPS/rackium-20200102-000000-daily.tar.gpg"
rackium-backup
BACKUP="$(find "$BACKUPS" -name 'rackium-*-daily.tar.gpg' -newermt '1 hour ago' | sort | tail -n 1)"
[ -f "$BACKUP" ] || fail "no backup"
[ -f "$OFFSITE/$(basename "$BACKUP")" ] || fail "not copied off the server"
cmp -s "$BACKUP" "$OFFSITE/$(basename "$BACKUP")" || fail "the off-server copy differs"
if tar -tf "$BACKUP" >/dev/null 2>&1; then fail "the backup is not encrypted"; fi
if grep -aq 'rackium_backup\|organisations' "$BACKUP"; then fail "plain text in the backup"; fi
[ ! -e "$BACKUPS/rackium-20200101-000000-daily.tar.gpg" ] || fail "an old local backup was kept"
[ ! -e "$OFFSITE/rackium-20200101-000000-daily.tar.gpg" ] || fail "an old off-server backup was kept"
[ -e "$BACKUPS/rackium-20200102-000000-daily.tar.gpg" ] || fail "a recent backup was removed"
rm -f "$BACKUPS/rackium-20200102-000000-daily.tar.gpg"
ok "encrypted, copied, rotated at 35 days"
systemctl is-enabled --quiet rackium-backup.timer || fail "the timer is off"
ok "the daily timer is on"
sed -i 's|^BACKUP_REMOTE=.*|BACKUP_REMOTE=|' /etc/rackium/deploy.conf
if rackium-backup >/dev/null 2>&1; then fail "a backup without an off-server copy succeeded"; fi
sed -i "s|^BACKUP_REMOTE=.*|BACKUP_REMOTE=$OFFSITE|" /etc/rackium/deploy.conf
ok "no off-server target: fails loudly"

step "Restore test: into a throwaway database"
OUT="$(rackium-restore --test "$BACKUP")"
echo "$OUT"
echo "$OUT" | grep -q 'Restore test passed' || fail "restore test"
echo "$OUT" | grep -qE 'organisations: [1-9]' || fail "restore test: no organisations"
curl -fsS http://127.0.0.1:4000/health >/dev/null || fail "the restore test touched the live app"
ok "the backup restores"
if head -c 2000 "$BACKUP" >/tmp/cut.gpg && rackium-restore --test /tmp/cut.gpg >/dev/null 2>&1; then fail "a damaged backup restored"; fi
ok "a damaged backup is refused"

step "Live restore: back to the backup"
BEFORE_ORGS="$(mongo_admin 'print(db.organisations.countDocuments())')"
mongo_admin 'db.organisations.insertOne({ name: "after the backup" }); db.users.deleteMany({ email: "viewer@example.com" })'
as_rackium sh -c 'rm /var/lib/rackium/files/smoke-marker'
# Like a new server: its database passwords are not the ones in the backup.
NEW_APP_PASSWORD="$(openssl rand -hex 32)"
OLD_APP_PASSWORD="$(sed -n 's/^MONGO_APP_PASSWORD=//p' /etc/rackium/mongo-admin.env)"
mongo_admin "db.getSiblingDB('rackium').changeUserPassword('rackium', '$NEW_APP_PASSWORD')"
sed -i "s/$OLD_APP_PASSWORD/$NEW_APP_PASSWORD/" /etc/rackium/mongo-admin.env /etc/rackium/rackium.env
if rackium-restore --live "$BACKUP" >/dev/null 2>&1; then fail "a live restore ran without the confirmation"; fi
curl -fsS http://127.0.0.1:4000/health >/dev/null || fail "the refused restore touched the app"
rackium-restore --live "$BACKUP" --yes-replace-everything
[ "$(mongo_admin 'print(db.organisations.countDocuments())')" = "$BEFORE_ORGS" ] || fail "the organisations did not come back"
[ "$(mongo_admin 'print(db.users.countDocuments({ email: "viewer@example.com" }))')" = 1 ] || fail "the deleted user did not come back"
[ -f /var/lib/rackium/files/smoke-marker ] || fail "the files did not come back"
[ "$(stat -c %U /var/lib/rackium/files/smoke-marker)" = rackium ] || fail "the files' owner"
STATUS="$(web -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$(jq -n --arg p "$DEMO_PASSWORD" '{email:"viewer@example.com",password:$p}')" "https://$DOMAIN/api/v1/auth/login")"
[ "$STATUS" = 200 ] || fail "sign-in after the restore: $STATUS"
ok "database and files restored, users sign in, auth still on"
mongosh --quiet --norc --eval 'db.getSiblingDB("rackium").getCollectionNames()' >/dev/null 2>&1 && fail "the restored database answers without a user" || ok "users required again"

step "A second release, then one that does not start"
TMP="$(mktemp -d)"
git clone --quiet --branch smoke "$SRC" "$TMP/w"
git -C "$TMP/w" -c user.name=smoke -c user.email=smoke@example.com commit --quiet --allow-empty -m 'second release'
git -C "$TMP/w" push --quiet origin smoke
chown -R rackium:rackium "$SRC"
rackium-deploy
SECOND_RELEASE="$(basename "$(readlink -f /opt/rackium/current)")"
[ "$SECOND_RELEASE" != "$FIRST_RELEASE" ] || fail "no new release"
ok "second release: $SECOND_RELEASE"
find "$BACKUPS" -name '*-pre-deploy.tar.gpg' | grep -q . || fail "no backup before migrating"
ok "a backup was taken before migrating"

printf '\nprocess.exit(1)\n' >"$TMP/first-line"
sed -i '1i process.exit(1)' "$TMP/w/server/src/index.js"
git -C "$TMP/w" -c user.name=smoke -c user.email=smoke@example.com commit --quiet -am 'a release that does not start'
git -C "$TMP/w" push --quiet origin smoke
chown -R rackium:rackium "$SRC"
if rackium-deploy; then fail "a broken release deployed"; fi
[ "$(basename "$(readlink -f /opt/rackium/current)")" = "$SECOND_RELEASE" ] || fail "did not go back by itself"
[ "$(web "https://$DOMAIN/health")" = '{"status":"ok","app":"up","database":"up"}' ] || fail "not healthy after going back"
ok "a broken release goes back by itself"

step "Rollback"
rackium-rollback --list
rackium-rollback "$FIRST_RELEASE"
[ "$(basename "$(readlink -f /opt/rackium/current)")" = "$FIRST_RELEASE" ] || fail "rollback"
[ "$(web "https://$DOMAIN/health")" = '{"status":"ok","app":"up","database":"up"}' ] || fail "not healthy after the rollback"
[ "$(echo "$(as_rackium pm2 jlist)" | jq '[.[] | select(.name=="rackium-api")] | length')" = 1 ] || fail "not one process after the rollback"
ok "rollback"

step "Migrations are recorded, and do not run twice"
mongo_admin 'if (db.opsMigrations.countDocuments({ _id: "2026-10-phase-history-backfill" }) !== 1) throw new Error("the backfill is not recorded")'
(cd /opt/rackium/current && as_rackium node server/scripts/migrate.mjs) | grep -q '0 run' || fail "a migration ran twice"
ok "migrations"

printf '\nThe runbook works on a clean server.\n'
