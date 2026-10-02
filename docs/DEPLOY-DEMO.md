# Deploying the Rackium demo

This is a static, client-only build (Vite + React) with no backend — the
"server" just needs to serve the built files over HTTPS, behind a password,
with client-side routing surviving a page refresh. Nothing in this repo
deploys itself; everything below is run by whoever owns the demo server.

## 1. Build

From `client/`:

```bash
npm ci
npm run build
```

This produces `client/dist/` — a fully static site. Open it locally first
with `npm run preview` to sanity-check before shipping it anywhere.

### Serving from a subpath

If the demo won't live at the domain root (e.g.
`https://demo.example.com/rackium/` instead of `https://demo.example.com/`),
set `VITE_BASE_PATH` before building so both the built asset URLs and
client-side routing account for it:

```bash
VITE_BASE_PATH=/rackium/ npm run build
```

Leave it unset (defaults to `/`) when the demo is served from the domain
root. Either way, the Nginx config below needs its `location` block to
match whatever path you chose.

## 2. Copy the build to the server

Copy the contents of `client/dist/` to wherever Nginx will serve it from,
e.g.:

```bash
rsync -av client/dist/ user@demo-server:/var/www/rackium-demo/
```

(Adjust the remote path to match `root` in the Nginx config below.)

## 3. Password-protect it (HTTP basic auth)

On the server, generate a password file (requires `apache2-utils` /
`httpd-tools` for `htpasswd`):

```bash
sudo apt-get install -y apache2-utils   # Debian/Ubuntu
sudo htpasswd -c /etc/nginx/.htpasswd-rackium-demo demo
# prompts for a password; add more users with -c omitted
```

## 4. HTTPS via Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d demo.example.com
```

Certbot will edit the Nginx server block in place to add the `ssl_certificate`
directives and a port-80-to-443 redirect, and sets up auto-renewal via a
systemd timer / cron job — no separate step needed for renewal.

## 5. Nginx site config

Install this **before** running certbot (certbot edits it in place to add
TLS), e.g. at `/etc/nginx/sites-available/rackium-demo`, then
`ln -s` it into `sites-enabled` and `nginx -t && systemctl reload nginx`.

```nginx
server {
    listen 80;
    server_name demo.example.com;

    root /var/www/rackium-demo;
    index index.html;

    # If served from a subpath (VITE_BASE_PATH=/rackium/ at build time),
    # change this to "location /rackium/ {" and adjust `root`/`alias`
    # accordingly, or nest this whole block under that location instead.
    location / {
        auth_basic           "Rackium demo";
        auth_basic_user_file /etc/nginx/.htpasswd-rackium-demo;

        # SPA fallback: any path that isn't a real file falls back to
        # index.html so React Router's client-side routing handles it —
        # without this, refreshing on e.g. /b/b001/hld 404s instead of
        # re-entering the app at that route.
        try_files $uri $uri/ /index.html;
    }

    # Hashed, versioned build assets (dist/assets/*) — safe to cache
    # aggressively; index.html itself is deliberately NOT cached (see
    # below) so a new deploy is picked up on next load.
    location /assets/ {
        auth_basic           "Rackium demo";
        auth_basic_user_file /etc/nginx/.htpasswd-rackium-demo;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /index.html {
        auth_basic           "Rackium demo";
        auth_basic_user_file /etc/nginx/.htpasswd-rackium-demo;
        add_header Cache-Control "no-cache";
    }
}
```

After `certbot --nginx -d demo.example.com` runs, this block gains a
`listen 443 ssl;` server (with `ssl_certificate`/`ssl_certificate_key`
pointing at the Let's Encrypt cert) and the port-80 block becomes a
redirect to HTTPS.

## Notes

- This demo has no real backend or auth — HTTP basic auth above is what
  actually gates access to it, not the in-app "Demo controls" role switcher
  (that's a UI convenience for walking through roles during the demo, not
  security).
- All demo data lives in the browser's IndexedDB (see "Reset demo data" in
  the top-bar user menu) — there's nothing server-side to reset between
  demo sessions beyond that one in-app button, and nothing to back up.
- Re-deploying a new build is just re-running steps 1-2; Nginx config and
  the certificate don't need to change unless the domain or base path does.
