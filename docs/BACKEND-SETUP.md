# Backend setup (developer)

This guide gets a developer from a fresh clone to a running API, the real
sign-in flow in the client, and a passing test run. You need about 20 minutes
and a free MongoDB Atlas account.

## Prerequisites

- Node.js 20 or later (`node -v`).
- npm (ships with Node).
- A MongoDB Atlas account (free tier is enough).

The repo is an npm workspace: `shared/`, `server/` and `client/`. Install once
from the root:

```bash
npm install
```

## 1. Create your own Atlas cluster

Each developer uses their own cluster, so nobody shares data or credentials.

1. In Atlas, create a free **M0** cluster. Any region is fine.
2. **Database Access:** add a database user with a password. Use a strong
   password and keep it out of git.
3. **Network Access:** add your current IP address. Atlas refuses connections
   from unknown addresses.
4. **Connect > Drivers:** copy the connection string. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/rackium?retryWrites=true&w=majority`.

Atlas clusters are replica sets, so multi-document transactions work on the
free tier. The server checks this at startup and refuses to run against a
standalone server.

## 2. Create `server/.env`

```bash
cp server/.env.example server/.env
```

Set these values in `server/.env`:

| Variable | What to put there |
|---|---|
| `MONGODB_URI` | the connection string from step 1 |
| `JWT_SECRET` | at least 32 random characters (see below) |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The other values have working defaults for development:

- `CLIENT_ORIGIN` and `PUBLIC_APP_URL` default to `http://localhost:5173`.
- `EMAIL_PROVIDER=console` writes emails to the server log. Use it in
  development. You do not need a Resend account to sign up and verify.

- `TRUST_PROXY` defaults to `0`: the server uses the connection's own address
  and ignores `X-Forwarded-For`. Set it to `1` only when the API runs behind one
  reverse proxy (Nginx on the VPS). Then the client address comes from the
  proxy's `X-Forwarded-For` header. Leave it at `0` if the API is reached
  directly, otherwise any client could set its own address. Rate limits and
  the recorded sign-in address both depend on this value.

`server/.env` is git-ignored. Never commit it.

**Production** is stricter. The server refuses to start when `NODE_ENV=production`
unless `JWT_SECRET` is a real value (not the example placeholder), `PUBLIC_APP_URL`
is https, and `EMAIL_PROVIDER=resend` with a `RESEND_API_KEY`.

## 3. Run the API

```bash
npm run dev --workspace @rackium/server
```

Check it is up:

```bash
curl http://localhost:4000/api/v1/health
```

You should see `{"status":"ok","database":"up","version":"0.1.0"}`. If startup
fails, the message names the variable that is missing or invalid.

The OpenAPI document is served at `http://localhost:4000/api/v1/openapi.json`.
To write it to a file: `npm run openapi --workspace @rackium/server`.

## 4. Run the client in real mode

The client has two modes:

- **mock** (default): the prototype, with mock data and no backend. All
  existing screens and the Playwright suite run in this mode.
- **real**: sign-up, sign-in, password reset and invitations use the API.

To use real mode, create `client/.env.local`:

```
VITE_API_MODE=real
```

Then start the client:

```bash
npm run dev --workspace client
```

Open `http://localhost:5173`. The dev server forwards `/api` to the API on
port 4000, so cookies stay on one origin.

Do not set `VITE_API_MODE=real` in a production build until the backend is
deployed. Mock mode is the default and stays the default.

## 5. Sign up and try it

1. Go to `/signup`, enter an organisation, your name, an email and a password
   of at least 12 characters.
2. Open the server log. The verification email is printed there, with its link.
3. Open the link. Sign in at `/login`.

Invitations work the same way: the invite email is printed to the log.

## 6. Run the tests

Tests do not need Atlas. They start their own in-memory MongoDB replica set.

```bash
npm run test:shared     # pure logic and the policy table
npm run test:server     # API, isolation and permission tests
npm run test:client     # client unit tests
npm run lint
npm run build
```

The first `test:server` run downloads a MongoDB binary (about 780 MB) into
`node_modules/.cache`. Later runs start in seconds. To fetch it ahead of time:

```bash
node server/scripts/fetch-mongo-binary.mjs
```

The Playwright suite runs against the production build in mock mode:

```bash
npm run test:e2e --workspace client
```

### Scheduled jobs

The API process runs a small scheduler (M5b) for notification email (every
minute), task due-date reminders (every 15 minutes) and the daily digest
email (checked every 15 minutes; each organisation's digest goes out at its
own local digest time — Organisation settings → Time zone, default 07:00
Europe/Berlin).
Jobs are stored in the `scheduledjobs` collection and claimed with a lock,
so running several API processes never sends anything twice. Tests never
start the scheduler; they call the jobs directly. In development, mail goes
to the console provider (the server log).

### Test database folders

Each in-memory database keeps its data on disk while tests run, in
`<system temp>/rackium-test-db/run-<id>/mongo-mem-<id>` (on Windows,
`%TEMP%\rackium-test-db`). They are removed automatically:

- each test file stops its database with the library's forced cleanup, which
  deletes its folder;
- the Vitest global setup (`server/test/globalSetup.js`) gives each run one
  folder and deletes it at the end, even after failures or a crashed worker;
- the Playwright global teardown asks the real-mode e2e server to shut down
  cleanly before Playwright kills it, so that server's database is removed too;
- each run first sweeps folders left by earlier runs that were killed outright.

A folder is only ever swept when the process that created it has gone, so a
test run in another terminal is never disturbed. To clean up by hand:

```bash
npm run clean:test-db
```

It only touches `rackium-test-db/run-*` folders whose run has ended. Other
`mongo-mem-*` folders in the temp folder (from other projects, or from runs
before this was added) are left alone. Each folder can grow to a few hundred
MB, and when the disk fills up `mongod` cannot start, so the API tests are
reported as **skipped** instead of failing. If you see that, check free disk
space first.

## Running MongoDB yourself instead of Atlas

Any single-node replica set works, including the one the VPS will run. Start
`mongod` with `--replSet`, then initiate it once:

```bash
mongod --replSet rs0 --dbpath ./data
mongosh --eval "rs.initiate()"
```

Use `MONGODB_URI=mongodb://localhost:27017/rackium?replicaSet=rs0`.

## Troubleshooting

- **"MongoDB must be a replica set"** at startup: your URI points at a
  standalone server. Use Atlas or a replica set, as above.
- **"JWT_SECRET must be at least 32 characters"**: regenerate the secret.
- **Cannot connect to Atlas**: check Network Access (your IP) and the user's
  password in the connection string. Special characters in the password must
  be URL-encoded.
- **Sign-in returns `email_not_verified`**: open the verification link from the
  server log first.
- **Too many attempts (429)**: sign-in is rate-limited per IP for 15 minutes.
  Restart the server to clear the in-memory limiter in development.
