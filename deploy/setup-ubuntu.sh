#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server for Rackium (docs/DEPLOY-DEMO.md). Run as
# root from a checkout of the repo:
#   sudo deploy/setup-ubuntu.sh --domain test.example.com --email you@example.com --repo git@github.com:owner/repo.git
# Safe to run again: what exists is kept, secrets above all. Secrets are generated
# here, written only to root-readable files, and never printed.
#   --self-signed     a self-signed certificate instead of Let's Encrypt (CI only)
#   --accept-kernel   skip the kernel check (CI only: its runner cannot change kernel)
set -euo pipefail

DOMAIN="" EMAIL="" REPO="" SELF_SIGNED=0 ACCEPT_KERNEL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --self-signed) SELF_SIGNED=1; shift ;;
    --accept-kernel) ACCEPT_KERNEL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$REPO" ] || { echo "Usage: setup-ubuntu.sh --domain DOMAIN --email EMAIL --repo GIT_URL [--self-signed]" >&2; exit 2; }
[ "$SELF_SIGNED" = 1 ] || [ -n "$EMAIL" ] || { echo "--email is required for Let's Encrypt." >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Before anything is installed: MongoDB would only fail much later.
[ "$ACCEPT_KERNEL" = 1 ] || bash "$HERE/check-kernel.sh"
HOME_DIR=/opt/rackium
ETC=/etc/rackium
step() { printf '\n== %s\n' "$*"; }
secret() { openssl rand -hex "${1:-32}"; }
as_rackium() { sudo -u rackium env -i HOME="$HOME_DIR" PM2_HOME="$HOME_DIR/.pm2" PATH="/usr/bin:/bin:/usr/local/bin" LANG=C.UTF-8 "$@"; }

step "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg openssl git jq ufw nginx certbot rclone rsync
install -d -m 0755 /etc/apt/keyrings

step "Node.js 22 LTS and PM2"
if ! command -v node >/dev/null || ! /usr/bin/node -e 'process.exit(+process.versions.node.split(".")[0]===22?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
/usr/bin/npm install -g --silent pm2@6

step "Chrome, for PDFs (Ubuntu's own Chromium is a snap, which a service cannot run reliably)"
if [ ! -x /usr/bin/google-chrome-stable ]; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" >/etc/apt/sources.list.d/google-chrome.list
  apt-get update -qq
  apt-get install -y -qq google-chrome-stable
fi

step "The rackium user and its folders"
id rackium >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash rackium
install -d -o rackium -g rackium -m 0750 "$HOME_DIR" /var/lib/rackium /var/lib/rackium/files
# Nginx reads the built client under here.
chmod 0755 "$HOME_DIR"
install -d -o rackium -g rackium -m 0755 "$HOME_DIR/releases"
install -d -o rackium -g rackium -m 0750 /var/log/rackium
install -d -o root -g rackium -m 0750 "$ETC"
install -d -o root -g root -m 0700 /var/lib/rackium/backups
install -d -m 0755 /var/www/certbot

step "MongoDB 8: one node, replica set, users required, localhost only"
if ! command -v mongod >/dev/null; then
  curl -fsSL https://pgp.mongodb.com/server-8.0.asc | gpg --dearmor --yes -o /etc/apt/keyrings/mongodb-8.gpg
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [signed-by=/etc/apt/keyrings/mongodb-8.gpg] https://repo.mongodb.org/apt/ubuntu ${VERSION_CODENAME}/mongodb-org/8.0 multiverse" >/etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update -qq
  apt-get install -y -qq mongodb-org
fi
MONGO_SECRETS="$ETC/mongo-admin.env"
if [ ! -f "$MONGO_SECRETS" ]; then
  umask 077
  cat >"$MONGO_SECRETS" <<EOF
MONGO_ADMIN_PASSWORD=$(secret)
MONGO_APP_PASSWORD=$(secret)
MONGO_BACKUP_PASSWORD=$(secret)
EOF
  umask 022
fi
chown root:root "$MONGO_SECRETS"
chmod 0600 "$MONGO_SECRETS"
# shellcheck disable=SC1090
. "$MONGO_SECRETS"
export MONGO_ADMIN_PASSWORD MONGO_APP_PASSWORD MONGO_BACKUP_PASSWORD
if [ ! -f /var/lib/mongodb/rs.key ]; then
  openssl rand -base64 756 >/var/lib/mongodb/rs.key
  chown mongodb:mongodb /var/lib/mongodb/rs.key
  chmod 0400 /var/lib/mongodb/rs.key
fi
install -m 0644 "$HERE/mongod.conf" /etc/mongod.conf
systemctl enable --quiet mongod
systemctl restart mongod
MONGO_UP=0
for _ in $(seq 1 60); do
  if mongosh --quiet --norc --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; then MONGO_UP=1; break; fi
  sleep 1
done
if [ "$MONGO_UP" != 1 ]; then
  echo "MongoDB did not start:" >&2
  systemctl status mongod --no-pager >&2 || true
  journalctl -u mongod --no-pager -n 40 >&2 || true
  exit 1
fi
# The first user and the replica set go in through MongoDB's localhost
# exception; passwords come from the environment, never the command line.
mongosh --quiet --norc --file "$HERE/mongo-init.js"

step "Secrets and settings"
ENV_FILE="$ETC/rackium.env"
if [ ! -f "$ENV_FILE" ]; then
  umask 027
  sed -e "s|@DOMAIN@|$DOMAIN|g" \
      -e "s|@MONGO_APP_PASSWORD@|$MONGO_APP_PASSWORD|g" \
      -e "s|@JWT_SECRET@|$(secret 48)|g" "$HERE/rackium.env.template" >"$ENV_FILE"
  umask 022
fi
chown root:rackium "$ENV_FILE"
chmod 0640 "$ENV_FILE"
BACKUP_KEY="$ETC/backup.passphrase"
if [ ! -f "$BACKUP_KEY" ]; then
  umask 077
  secret 48 >"$BACKUP_KEY"
  umask 022
fi
chown root:root "$BACKUP_KEY"
chmod 0600 "$BACKUP_KEY"
# mongodump and mongorestore read this, so the password is on no command line.
MONGO_TOOLS="$ETC/backup-mongo.yaml"
umask 077
printf 'uri: mongodb://rackium_backup:%s@127.0.0.1:27017/?replicaSet=rs0&authSource=admin\n' "$MONGO_BACKUP_PASSWORD" >"$MONGO_TOOLS"
umask 022
chown root:root "$MONGO_TOOLS"
chmod 0600 "$MONGO_TOOLS"
if [ ! -f "$ETC/deploy.conf" ]; then
  cat >"$ETC/deploy.conf" <<EOF
# Read by rackium-deploy, rackium-backup and rackium-restore.
REPO_URL=$REPO
DEPLOY_REF=develop
DOMAIN=$DOMAIN
# An rclone remote and folder for the off-server copy, e.g. offsite:rackium-backups
# (rclone config, as root). Backups fail loudly while this is empty.
BACKUP_REMOTE=
BACKUP_KEEP_DAYS=35
EOF
fi
chown root:rackium "$ETC/deploy.conf"
chmod 0640 "$ETC/deploy.conf"

step "The operations commands"
install -m 0755 "$HERE/deploy.sh" /usr/local/sbin/rackium-deploy
install -m 0755 "$HERE/rollback.sh" /usr/local/sbin/rackium-rollback
install -m 0755 "$HERE/backup.sh" /usr/local/sbin/rackium-backup
install -m 0755 "$HERE/restore.sh" /usr/local/sbin/rackium-restore
install -m 0644 "$HERE/rackium-backup.service" /etc/systemd/system/rackium-backup.service
install -m 0644 "$HERE/rackium-backup.timer" /etc/systemd/system/rackium-backup.timer
systemctl daemon-reload
systemctl enable --quiet --now rackium-backup.timer

step "Pulling the code: a read-only key for the rackium user"
if [ ! -f "$HOME_DIR/.ssh/id_ed25519" ]; then
  sudo -u rackium mkdir -p "$HOME_DIR/.ssh"
  sudo -u rackium chmod 700 "$HOME_DIR/.ssh"
  sudo -u rackium ssh-keygen -q -t ed25519 -N '' -C "rackium-deploy@$DOMAIN" -f "$HOME_DIR/.ssh/id_ed25519"
  ssh-keyscan -t ed25519 github.com 2>/dev/null | sudo -u rackium tee -a "$HOME_DIR/.ssh/known_hosts" >/dev/null
fi

step "Nginx and the certificate"
install -D -m 0644 "$HERE/nginx/security-headers.conf" /etc/nginx/snippets/rackium-security-headers.conf
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/rackium /etc/nginx/sites-enabled/rackium
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  if [ "$SELF_SIGNED" = 1 ]; then
    install -d -m 0755 "$CERT_DIR"
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" 2>/dev/null
  else
    sed "s|@DOMAIN@|$DOMAIN|g" "$HERE/nginx/rackium-bootstrap.conf.template" >/etc/nginx/sites-available/rackium
    nginx -t
    systemctl reload-or-restart nginx
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --deploy-hook "systemctl reload nginx"
  fi
fi
sed "s|@DOMAIN@|$DOMAIN|g" "$HERE/nginx/rackium.conf.template" >/etc/nginx/sites-available/rackium
nginx -t
systemctl enable --quiet nginx
systemctl reload-or-restart nginx

step "Firewall: only 22, 80 and 443"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose

step "PM2 starts on boot, its logs rotate"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u rackium --hp "$HOME_DIR" >/dev/null
as_rackium pm2 install pm2-logrotate >/dev/null
as_rackium pm2 set pm2-logrotate:retain 14 >/dev/null

cat <<EOF

Done. Still by hand (docs/DEPLOY-DEMO.md):
  1. Add this read-only key to the GitHub repo (Settings, Deploy keys):
     $(cat "$HOME_DIR/.ssh/id_ed25519.pub")
  2. Put the Resend API key in $ENV_FILE
  3. Set BACKUP_REMOTE in $ETC/deploy.conf, after 'rclone config' as root
  4. Copy $BACKUP_KEY somewhere safe, off this server: without it no backup can be read
  5. sudo rackium-deploy
EOF
