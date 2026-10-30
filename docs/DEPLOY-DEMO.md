# Rackium test server: the runbook

How to put Rackium on a clean Ubuntu 24.04 server, keep it backed up, update it and go back. The scripts are run for real by CI on a clean Ubuntu 24.04 (`.github/workflows/deploy-smoke.yml`, `deploy/smoke-test.sh`). Three things differ there: a self-signed certificate, a local folder as the off-server copy, and a workaround setting for the kernel of GitHub's machines (see "Before you start").

**Secrets stay on the server.** The scripts generate them there and never print them. Do not paste a password, API key or the backup passphrase into a chat, a ticket or the repo.

## What ends up where

| | |
|---|---|
| Web | Nginx, ports 80 and 443: HTTPS, security headers, gzip, the built client, `/api` to the app |
| App | One PM2 process in fork mode (`rackium-api`), on `127.0.0.1:4000`. Never more than one: rate limits are held in its memory |
| Database | MongoDB 8, one-node replica set, users required, `127.0.0.1` only |
| PDFs | Google Chrome (`/usr/bin/google-chrome-stable`). Ubuntu's own Chromium is a snap, which a service cannot run reliably |
| Firewall | 22, 80 and 443 only |
| Code | `/opt/rackium/releases/<time>-<commit>`, with `/opt/rackium/current` pointing at the live one |
| Settings and secrets | `/etc/rackium/` (`rackium.env`, `deploy.conf`, `backup.passphrase`, `backup-mongo.yaml`, `mongo-admin.env`) |
| Uploaded files and backups | `/var/lib/rackium/files`, `/var/lib/rackium/backups` |
| Commands | `rackium-deploy`, `rackium-rollback`, `rackium-backup`, `rackium-restore` (run with `sudo`) |

## Before you start

- [ ] A server with Ubuntu 24.04, at least 2 CPUs, 4 GB of memory and 40 GB of disk. You can sign in with your SSH key and use `sudo`.
- [ ] A Linux kernel MongoDB 8 accepts: not 6.19 through 7.0.13 ([its release notes](https://www.mongodb.com/docs/manual/release-notes/8.0.md)). Check with `uname -r`. Ubuntu 24.04's standard kernel (6.8) is fine; a provider's newer one may not be. Setup checks this first and says what to do.
- [ ] SSH on port 22. The firewall opens only 22, 80 and 443, so another SSH port would lock you out.
- [ ] A domain name for it, with an A record pointing at the server. Check with `dig +short test.example.com`. Let's Encrypt needs this before step 2.
- [ ] A [Resend](https://resend.com) account with the domain verified (invitations come from `no-reply@<domain>`) and an API key.
- [ ] Somewhere off the server for backups that rclone can reach: an S3 bucket, Backblaze B2, or another server over SFTP.
- [ ] The tester list: name, email and role of each person.

In the commands below, replace `test.example.com`, `you@example.com` and `you@server` with your own.

## 1. Copy the scripts to the server

The code is pulled with a key that step 2 creates, so the scripts go over first. On your computer, in Git Bash, from the repo:

```bash
git fetch origin
git archive origin/develop deploy | ssh you@server "mkdir -p ~/rackium-setup && tar -x -C ~/rackium-setup"
```

## 2. Prepare the server

On the server:

```bash
sudo ~/rackium-setup/deploy/setup-ubuntu.sh \
  --domain test.example.com \
  --email you@example.com \
  --repo git@github.com:Handsome050111/rackium.git
```

This installs everything in the table above, generates the secrets and gets the certificate. It is safe to run again: what exists is kept, secrets above all. It ends by listing the steps below.

## 3. The steps by hand

**The deploy key.** Setup printed a public key. In GitHub: the repo, Settings, Deploy keys, Add deploy key. Paste it and leave "Allow write access" off. A public key is safe to share.

**The Resend key.** On the server:

```bash
sudo nano /etc/rackium/rackium.env     # set RESEND_API_KEY=...
```

The app refuses to start while it still says `__SET_ME__`.

**The off-server copy.** As root, create an rclone remote, then name it in `deploy.conf`:

```bash
sudo rclone config                     # e.g. a remote called "offsite"
sudo nano /etc/rackium/deploy.conf     # BACKUP_REMOTE=offsite:rackium-backups
```

Backups fail loudly while `BACKUP_REMOTE` is empty.

**The backup passphrase.** Without it no backup can be read, and it is not in the backups. Show it once on the server and put it in your password manager:

```bash
sudo cat /etc/rackium/backup.passphrase
```

If the server is lost, this is what makes the off-server copies usable.

## 4. First deploy

```bash
sudo rackium-deploy
```

It pulls `DEPLOY_REF` from `/etc/rackium/deploy.conf` (`develop`), installs, builds the release client (which refuses to contain mock mode), checks that a PDF can be made, runs the migrations, switches, restarts and checks health directly and through Nginx. To deploy something else: `sudo rackium-deploy <branch, tag or commit>`.

Check from your own computer:

```bash
curl https://test.example.com/health
# {"status":"ok","app":"up","database":"up"}
```

The site should show the amber banner: "Test environment — do not enter real customer data". The wording is `ENV_BANNER` in `rackium.env`; empty means no banner. After changing `rackium.env`, restart the app: `sudo -u rackium env PM2_HOME=/opt/rackium/.pm2 pm2 restart rackium-api`.

## 5. The phase history backfill

**Nothing to do: it ran in step 4.** `rackium-deploy` runs every pending migration once and records it in the `opsMigrations` collection, and the phase history backfill (`2026-10-phase-history-backfill`) is the first. It writes rows only for what the audit log can prove and marks them derived; phases with no evidence get no date ("date unknown").

To run it again by hand (harmless; a second run writes 0 rows):

```bash
cd /opt/rackium/current/server && sudo -u rackium env HOME=/opt/rackium node scripts/backfill-phase-history.mjs
```

To see what has run:

```bash
cd /opt/rackium/current && sudo -u rackium env HOME=/opt/rackium node server/scripts/migrate.mjs
# Migrations: 0 run, N already done.
```

The API builds the search indexes on start.

## 6. The demo project

Synthetic data only, like `dev:local`. Once:

```bash
cd /opt/rackium/current && sudo -u rackium env HOME=/opt/rackium node server/scripts/seed-test-server.mjs
```

It takes a few minutes (it renders real PDFs), refuses to run if the demo organisation already exists, and generates a new password for the demo users. That password is only in `/opt/rackium/demo-logins.txt`, readable by the `rackium` user alone:

```bash
sudo cat /opt/rackium/demo-logins.txt
```

Demo users have `@example.com` addresses. No mail is sent to those, so they cause no bounces.

## 7. Invite the testers

Write the list on the server. It holds personal data, so it stays out of the repo and goes when you are done:

```bash
sudo -u rackium nano /opt/rackium/testers.csv
```

```csv
name,email,role
Ana Tester,ana@example.org,Architect
Fred Field,fred@example.org,Field Engineer
```

The role is a role name or key, the same as on the Team page. A mistake in the list gets told to you by line number, and nothing is sent until the whole list is right.

```bash
cd /opt/rackium/current
sudo -u rackium env HOME=/opt/rackium node server/scripts/invite-testers.mjs --file /opt/rackium/testers.csv --dry-run
sudo -u rackium env HOME=/opt/rackium node server/scripts/invite-testers.mjs --file /opt/rackium/testers.csv
sudo rm /opt/rackium/testers.csv
```

By default they join the demo organisation and its project (`CNR`). `--organisation "Name"` and `--project CODE` choose others. Running it again skips people already invited or already members. Public sign-up is closed (`SIGNUP_ENABLED=false`).

## 8. Backups

`rackium-backup.timer` runs daily: database and uploaded files, encrypted with the passphrase, copied off the server, checked for size, and deleted after 35 days in both places.

Run the first one by hand and test it **before testers start**:

```bash
sudo rackium-backup
sudo rackium-restore --test /var/lib/rackium/backups/<the file it named>
```

The test restores into a throwaway database on another port, checks the checksums, prints the counts and touches nothing live. Repeat it monthly.

Is it running?

```bash
systemctl list-timers rackium-backup.timer
sudo cat /var/lib/rackium/backups/last-success
journalctl -u rackium-backup -n 50
```

`deploy.conf` sets `BACKUP_KEEP_DAYS`. Deploys also take a backup before migrating; those stay on the server for 7 days.

## 9. Restore for real

This replaces the live database and files with the backup. The app is down meanwhile, and anything after the backup is lost. The old data is moved to `/var/lib/rackium/replaced-<time>`, not deleted.

```bash
# Only if the backup is not on the server any more:
sudo rclone copy offsite:rackium-backups/<file> /var/lib/rackium/backups/

sudo rackium-restore --live /var/lib/rackium/backups/<file> --yes-replace-everything
```

It ends healthy or says it is not. Sign in, check, then delete the `replaced-<time>` folder.

**A new server** after losing the old one: steps 1 to 4, then put the saved passphrase back with `sudo nano /etc/rackium/backup.passphrase`, fetch the backup with rclone and restore it as above. The new server's own database passwords are kept, so the app connects straight away. Everyone has to sign in again, because the new server has its own `JWT_SECRET`.

## 10. Update

```bash
sudo rackium-deploy
```

That is all. Each release gets its own folder, so the old one stays intact. Order: pull, install, build, PDF check, backup, migrate, switch, restart, health check. If the health check fails, **it goes back to the previous release by itself** and exits with an error. The newest four releases are kept.

## 11. Roll back

```bash
sudo rackium-rollback            # the release before this one
sudo rackium-rollback --list     # what is there
sudo rackium-rollback <name>     # a named one
```

This changes the code only. Migrations only add, so an earlier release runs on a newer database. If a migration itself did damage, restore the backup the deploy took just before it (step 9, `rackium-*-pre-deploy.tar.gpg`), then roll back.

## 12. When something is wrong

| What you see | Look at |
|---|---|
| The app | `sudo -u rackium env PM2_HOME=/opt/rackium/.pm2 pm2 logs rackium-api --lines 100` |
| Is it up? | `sudo -u rackium env PM2_HOME=/opt/rackium/.pm2 pm2 status`, `curl -s http://127.0.0.1:4000/health` |
| `/health` says `"database":"down"` | `sudo systemctl status mongod`, `sudo tail -n 50 /var/log/mongodb/mongod.log` |
| MongoDB will not start after a reboot | `journalctl -u mongod -n 20`. "Linux kernel versions 6.19" means an update moved the server onto a kernel it refuses: `bash /opt/rackium/current/deploy/check-kernel.sh` says what to do |
| The app refuses to start | The first error line names the setting in `/etc/rackium/rackium.env` that is missing or wrong |
| 502 from the site | The app is down: see the first row |
| Invitations do not arrive | The Resend dashboard (domain verified?), then the app log. Retries are automatic |
| PDFs fail | `cd /opt/rackium/current && sudo -u rackium env HOME=/opt/rackium node server/scripts/check-pdf.mjs` prints the browser's own output. People see only "could not be generated"; the reason is in the app log |
| Certificate | `sudo certbot certificates`, `sudo certbot renew --dry-run`. Renewal is automatic |
| "Another deploy is running" | Wait for it. Only one runs at a time |
| Backup failed | `journalctl -u rackium-backup -n 50`. An empty `BACKUP_REMOTE` or an unreachable off-server target fails on purpose |

An expected state of the firewall: `sudo ufw status` shows only 22, 80 and 443.
