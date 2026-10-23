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

`test:server` runs the document-rendering tests (`api.m6b.test.js`, which
start headless Chromium) in a second Vitest process after all other files, so
PDF rendering can never slow the other API tests into their timeouts. Test
files within each process run one at a time; each file has its own in-memory
replica set, cleared before every test.

A test that ends — or times out — can never touch the next test's data
(`server/test/helpers/isolation.js`, set up for every file): its test apps
then refuse requests (503 `stale_test`), database writes from work it left
in flight are refused, and the next test starts only once its requests are
done. `test/isolation.test.js` proves it with a deliberately timed-out
fixture, with the isolation on and off.

The server API tests render PDFs in headless Chromium, so install it once
before the first run (`npx playwright install chromium`, also needed for
the Playwright suite). Without it the document tests fail with "Cannot
start Chromium for PDF generation". CI installs it before the server tests.

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

### Generated documents (M6b)

PDFs are rendered by headless Chromium through `playwright-core`. On a
development machine the Chromium that Playwright downloaded for the tests is
used (`npx playwright install chromium` once). On a server without it, either
run that command as the API's user or install the distribution's Chromium and
point `CHROMIUM_PATH` at it in `server/.env`:

```
CHROMIUM_PATH=/usr/bin/chromium
```

Documents are background jobs in the `generateddocuments` collection. A
request starts processing at once in the same process, and the scheduler's
`documents` job (every 15 seconds) picks up anything left — after a restart,
or a run that died (its lock expires; at most 3 attempts). Set
`DOCUMENTS_AUTO_PROCESS=false` to leave rendering to the scheduler only.
Files are stored through the file service under `FILE_STORAGE_DIR`
(`documents/<project>/<file id>`); logos under `branding/`.

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
test run in another terminal is never disturbed.

Files the test apps store (uploads, generated documents) live in the same run
folder, one per test process (`run-<id>/files-<pid>`). Each is removed when its
test file ends — also after failed or timed-out tests — and when the process
exits; the run teardown and the sweep catch a worker that crashed or was
killed. Before M7a-3 they went to `<system temp>/rackium-test-files-<pid>` and
were never removed; those old folders are swept too (at the start of a run
and by `clean:test-db`), once their process has gone or they are a day old.

To clean up by hand:

```bash
npm run clean:test-db
```

It only touches `rackium-test-db/run-*` folders whose run has ended and the
old `rackium-test-files-<pid>` folders. Other
`mongo-mem-*` folders in the temp folder (from other projects, or from runs
before this was added) are left alone. Each folder can grow to a few hundred
MB, and when the disk fills up `mongod` cannot start, so the API tests are
reported as **skipped** instead of failing. If you see that, check free disk
space first.

### Stopping a test run without leaving processes behind

A test run is a tree of processes: `npm` → Vitest (or Playwright) → its
workers → the in-memory `mongod` and its watchdog. Stopping only the top
process can leave the rest running, still using CPU (and slowing the next
run into timeouts) and still writing to the old run's log. Always stop the
whole tree, then check nothing is left before starting the next run:

```powershell
taskkill /T /F /PID <pid of the npm or vitest process>

# Nothing from a test run may remain. Test databases run as
# mongod-x64-win32-<version>.exe from node_modules\.cache\mongodb-memory-server;
# a "mongod" from Program Files is an installed MongoDB service — leave it.
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -like 'mongod-x64-win32*' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|playwright|test:server|test:e2e|testServer|mongo_killer') } |
  Select-Object ProcessId, Name, CommandLine
```

The check must come back empty. Run test suites one at a time: two at once
(or a test suite next to a build or other heavy work) can push tests past
their timeouts.

## Backfilling phase history (M7a-1, once per environment)

Phase completion dates feed the SLA burn-downs. From M7a-1 the server records
them as they happen (`phaseHistory`, append-only). Phases finished before
that are filled in once, from the audit log, by a script — never on server
start:

```bash
cd server
node scripts/backfill-phase-history.mjs
```

It reads `server/.env` like the API, prints how many rows it wrote, and is
idempotent: a second run writes nothing. Rows it writes are marked derived;
where the audit log has no evidence of when a phase finished, the date stays
empty and is shown as "date unknown" — the script never invents a date.

There is no dev database with real data: the first run is on staging, as an
item of the go-live checklist in DEPLOY-DEMO.

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
