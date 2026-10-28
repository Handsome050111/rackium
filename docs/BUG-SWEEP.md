# Bug sweep

Two sweeps are recorded here: the M1 backend foundation (first part) and the
frontend in mock mode (second part, from the Definition of done in CLAUDE.md).
Items marked **fixed** have a regression test. Items marked **open** are known
and not fixed; each says why.

## Part 1: M1 backend foundation

Scope: the M1 code on `feature/m1-backend` (shared policy and contracts, server
core, tenancy, auth, organisations, audit, OpenAPI, and the client real-mode
auth screens). Method: read every M1 route and service against its tests, run
the full test suite, and walk each auth flow for the cases the tests do not
cover.

### Fixed

| # | Severity | Problem | Fix | Test |
|---|---|---|---|---|
| 1 | High | An unverified user who accepted an invitation got a membership and tokens, but `/me` returned 401 because the account stayed `pending_verification`. | Accepting an invitation proves the address is theirs, so it now activates the account and sets `emailVerifiedAt`. | `accepting an invitation verifies an unverified existing account…` |
| 2 | Medium | `GET /orgs/:orgId/projects` returned every project in the organisation to any member, including viewers. | Org Admins see all projects. Everyone else sees only the projects they hold a membership in. | `a project list shows an ordinary member only their own projects…` |
| 3 | Medium | A PM could not invite anyone, so a PM had to ask an Org Admin to add each member to their own project. | New policy action `invite_project_members` (Org Admin and PM). A PM may invite only into a project where they hold the PM role. Organisation-level invitations stay Org Admin only. Validation runs before authorisation so the project id is known. | `a PM invites project members into their own project only`; `a reviewer, architect or viewer on a project cannot invite into it`; policy unit test |
| 4 | Medium | No way to resend a verification email. If the send failed after sign-up committed, the person was stuck. (Open item A.) | `POST /auth/verify-email/resend`: rate-limited (5/hour), same reply whether or not the account exists, marks earlier unused links used, audit entry `auth.verification_resent`. Client: "Resend verification email" on the sign-up check-email screen and on the sign-in "email not verified" state. | `server/test/api.resend.test.js` (verification cases); `client/src/api/authApi.resend.test.js` |
| 5 | Medium | No way to resend an invitation. (Open item B.) | `POST /orgs/:orgId/invitations/:invitationId/resend`: rate-limited (20/hour), replaces the token hash (old link stops working), extends expiry to 7 days, audit entry `invitation.resent`. Org Admins may resend any; a PM only into their own project. Client: Team page "Resend invitation". | `server/test/api.resend.test.js` (invitation cases: org admin, PM own vs other project, reviewer 403, accepted 404, cross-org 404, pending-list scoping) |
| 6 | Low | Refresh rotation claimed the old token before issuing the new one. Two requests racing on the same cookie (two tabs, or a retry) made the second one look like reuse and signed the user out. (Open item C.) | A rotated refresh token is accepted again for 30 seconds, if its family still has a live token. The request gets a new session in the same family. After that window, or after logout, presenting it still revokes the family. | `a rotated token presented again within 30 seconds gets a session in the same family`; `after logout, a token rotated within the grace window does not start a new session`; `a token presented after rotation and the grace window revokes the whole family` |
| 7 | Medium | `TRUST_PROXY` defaulted to 0, so behind Nginx every client shared the proxy address. (Open item E.) | Left configurable and default-off (0 = socket address). Set `TRUST_PROXY=1` on the VPS. Documented in BACKEND-SETUP.md and DEPLOY-DEMO.md, with the Nginx `X-Forwarded-For` header. Clients are taken from `X-Forwarded-For` only when enabled. |`api.trust-proxy.test.js`: default ignores X-Forwarded-For; TRUST_PROXY=1 takes it |
| 8 | Low | Membership scopes were not checked against any object. (Open item F.) | Scopes must name a country, SAL or building in the organisation. Those objects are created in M2, so until then any non-empty scope list is refused, on invitations and on membership updates. Clearing scopes is still allowed. M2 replaces the refusal with a lookup. | `api.scopes.test.js` (invitation with a scope refused; membership update with a scope refused; clearing allowed) |

Earlier in M1 (covered by tests in the M1 commits): logout and password reset
did not end outstanding access tokens; reuse of a rotated refresh token was
logged even when the family had already been revoked; queries returned as lazy
values escaped the tenant scope.

### Open (not fixed in M1)

| # | Severity | Problem | Suggested owner / fix |
|---|---|---|---|
| D | Medium | Rate limits are held in process memory. Two PM2 instances would each allow the full limit. | **Documented, not fixed.** The API runs as one PM2 process (`-i 1`), never cluster mode. DEPLOY-DEMO.md says so. Scale-out needs a shared rate-limit store first. |
| G | Low | The invitation audit entry records the invitee's email address in plain text. | Keep it for the audit trail, but confirm retention with the client when the GDPR purge is built. |
| H | Info | Approval routes do not exist yet, so the "architect cannot approve own work" rule (`canApproveSubmission`) is not yet enforced by any endpoint. | M2 must call `canApproveSubmission` in every internal approval route, with a test per route. |
| I | Info | The development console email provider writes verification and reset links, including tokens, to the server log. Production refuses this provider (checked at startup). | None, as long as production config is used. Keep the startup check tested. |
| J | Info | CI runs lint, unit and API tests and the client build, but not the Playwright suite. | Add a Playwright job once the backend has a deploy target. |
| K | Info | Commit `38da5be` is titled "M1.3 follow-up" but contains the client real-mode work. | Message-only fix, to be agreed before rewriting the branch again. |

### Checked and found correct

- Cross-organisation access returns 404 for every organisation route, so the
  response never reveals whether an organisation exists.
- Sign-in responses are identical for a wrong password and an unknown email,
  and an unknown email still pays the cost of a password check.
- The last Org Admin cannot be revoked, and every membership change writes a
  field-level audit entry.
- Password reset ends every session, including outstanding access tokens.
- Audit entries cannot be updated or deleted through any model.
- Production refuses to start with a placeholder secret, a non-https public URL,
  or the console email provider.

## Part 2: Frontend sweep (mock mode)

Scope: every screen in mock mode at 1440, 1024, 768 and 390 px: Building
Overview, CMO, Survey structure (building and campus), Rack survey, all 18 room
survey tabs and 6 building tabs, HLD, LLD, Rackium Editor, BOM, Solution Package
(3 pages), client approval page, Deployment, CMDB, Handover, Demo guide, sign-in,
sign-up, unknown screen. Checks: console errors, page errors, horizontal
overflow, unfinished or broken text (`undefined`, `NaN`, `[object Object]`,
"later step"), every internal link, and whether each visible button changes
something on screen.

### Fixed

| # | Severity | Problem | Fix | Test |
|---|---|---|---|---|
| 9 | Major | Any unknown screen under a building (for example `/b/b001/no-such-screen`) showed "<phase> screen is built in a later step", which is unfinished text in front of a client. | Replaced with a "Page not found" view and a link back to the building overview. | `client/e2e/bug-sweep.spec.js` › unknown screens |
| 10 | Minor | The dashboard's "View full history" button had no handler and no target screen. | Restored as a link to a new Activity page (`/b/:id/activity`) listing the dashboard history, with an empty state. Spec v2.3 §7.2, client audit item 13. | `client/e2e/bug-sweep.spec.js` › top bar and dashboard controls open their targets |
| 11 | Minor | The top bar Notifications bell and Settings button had no handler. | Bell opens a notifications panel with All / Unread tabs and "No notifications yet" (real notifications come in M5). Settings opens a Settings page (`/b/:id/settings`) with Organisation, Members and Project settings. Members links to the Team page in real mode. Other sections say "Available soon". | `client/e2e/bug-sweep.spec.js` › top bar and dashboard controls open their targets |
| 12 | Major | Edits were lost if the page reloaded within 2 seconds of them (autosave every 2 s, not flushed on reload). | Autosave every 500 ms, and a flush on `pagehide`. | `client/e2e/sweep-round3.spec.js` › persistence across reload › an edit on a building-scope survey tab survives a reload |
| 14 | Major (phone) | On phone, Deployment could not select a device by tap. The zoomed-out canvas intercepted the tap, so serial, installation and link tests could not be recorded on phone. (Open item Q.) The deployment specs skipped device selection on phone. | Added a location tree (Building > Floor > Room > Rack > Device) with a status icon and counts per node. On phone, the device list is the main view. Tapping a device opens its full checklist on its own screen, with a Back button. The canvas is a view-only Map tab. On tablet and desktop, the tree sits beside the canvas and stays in sync with it. The tree builder is a pure function in `shared/src/locationTree.js`. The three phone skips are removed. | `shared/src/locationTree.test.js` (9 tests); `client/e2e/deployment-tree.spec.js` (phone list, full-screen checklist and Back, Map view, tablet/desktop sync, touch height); `client/e2e/deployment.spec.js` (the three tests that were skipped on phone now run there) |
| 13 | Major (phone) | Every `h-touch` and `w-touch` control was not 44 px. The size was defined only as `minHeight`/`minWidth`, so the height and width utilities produced nothing. Affected 60 and 11 uses across the app. | Added `height` and `width` tokens of 44 px in `tailwind.config.js`. Survey Add row also changed to `h-touch sm:h-8`. | `client/e2e/sweep-round3.spec.js` › phone touch targets |

Note: an earlier draft of this round removed these three controls. That was
wrong, because the spec requires them. They were restored in the same round.

### Found and decided, not changed

| # | Severity | Finding | Reason it is not changed |
|---|---|---|---|
| L | Info | The building overview shows 5 blockers: 2 static items and 3 SAL-wide unassigned devices. | Intentional under brief decision D39 (SAL-wide unassigned devices are blockers until assigned). Not a bug. |
| M | Low | The mock "now" is fixed at 2026-09-30 (`shared/src/time.js`), while the real date is later. Relative times such as "3 days ago" are computed from that fixed date. | Demo data is anchored to a fixed date so the demo is repeatable. Revisit when the demo moves to real data. |
| N | Info | Overall progress on the dashboard shows 44%. Checked against `computeOverallProgress` and `PROGRESS_WEIGHT` in `shared/src/phaseCalculations.js`: the mean of the phase weights, rounded. | Correct as computed. No change. |
| O | Info | Buttons such as Generate HLD, Save Version, Import floor plan, and Cancel in the Rackium Editor showed no visible text change in the click sweep. Each has a handler (checked in source). | The sweep only looks for visible text changes, so these may be state-only actions. Not confirmed as bugs. Their behaviour needs its own check in the next round. |

| P | Info | HLD and LLD Playwright specs failed in the first full run (many 30-second timeouts). | Not a code regression. The cause was two Playwright runs at once (plus stale vite servers) competing for port 5173. On a clean run, `develop` (worktree at 7ff2c8b, client only) gives 62 passed and 14 skipped for `hld.spec.js` and `lld.spec.js`, and `feature/m1-backend` gives the same. |

### Round 3: checks that were not covered before

Spec: `client/e2e/sweep-round3.spec.js` (9 tests, run at all four widths).

| Area | Result |
|---|---|
| Persistence across reload (building-scope survey tab; room table row) | **Bug, fixed (item 12).** Edits were saved every 2 seconds and not on reload, so an edit made in the last 2 seconds before a reload was lost. Now saved every 500 ms and flushed on `pagehide`. Test: edit, wait 1 s, reload, value present. |
| "Reset demo data" | Checked. The edit is discarded and the seed value returns. |
| Building-scope role gating (Viewer, Field Engineer) | Checked. A Viewer cannot type into a building-scope tab or a room tab, and has no Submit or Add row. A Field Engineer sees Submit but not Verify. No bug found. |
| Phone touch targets (survey Add row, user menu) | **Bug, fixed (item 13).** The `touch` size was defined only as `minHeight`/`minWidth`, so every `h-touch`/`w-touch` control (60 and 11 uses) was not 44px on any screen. Added `height`/`width` tokens. Test: Add row and user menu are at least 44px on phone. |
| Phone tap on a survey tab | Checked. Opens its form. |
| Offline survey sync in the browser | Covered by existing specs in `survey-forms.spec.js`: an offline edit syncs on reconnect, and a conflicting edit from another device is reported. Not repeated here. |
| Demo guide click-through | Checked. Every internal link in the guide opens a real screen with no page errors. |

### Open from round 3

None. Item Q is fixed (fixed item 14, above).

## Part 3: M2 review follow-ups

Four items from the M2 review, on `feature/m2-projects`.

### OpenAPI coverage

The document was missing every M2 route (hierarchy, blockers, dashboard,
View As, and the single-project GET/PATCH) — 32 routes, found by building a
test that lists what the app actually serves and compares it against the
document, rather than trusting a hand-kept list of either. All 32 are now
registered in `openapi/document.js`.

`http/routeRecorder.js` wraps each router so every route registered through
it is recorded as it happens (`router.__routes`), with its own mount prefix
joined in by `routes/index.js`. `app.js` exposes the combined list as
`app.__apiRoutes`. `test/api.openapi-coverage.test.js` fails if any of them
has no matching `registerPath()` — since the list comes from the same
registration calls the app runs on, not a parallel manifest, it cannot itself
drift the way the document previously did.

### Real-mode Playwright harness

`server/e2e/testServer.mjs` boots the real Express app against an in-memory
Mongo replica set, rate limits off. `client/e2e-real/journey.spec.js` runs
against it: sign-up → email verification → the wizard (CSV import) → project
list → project home → the real dashboard (raise/assign/resolve a blocker,
recent activity) → Settings (hierarchy add + delete-refused, phase gating's
add/remove rules, Members) → View As (banner, writes blocked, Exit) →
cross-project access denied for a second, unrelated organisation. Sent
emails are read from `server/e2e/.runtime-emails.json`, written by a mailer
in `testServer.mjs` — nothing test-only was added to `app.js` itself.

The client's own `/api` proxy (already used by `vite dev`) is reused for
`vite preview` too (`vite.config.js`'s new `preview.proxy`), so the real-mode
build talks to the test server same-origin — no CORS or cross-origin cookie
handling needed. Playwright's `real` project (`client/e2e-real/`) is separate
from the mock-mode projects, which are unchanged.

Two real bugs surfaced while building this:
- **View As was lost on every page reload.** It only lived in a React
  `useState`, which a full navigation wipes along with the rest of the page's
  JS. A person who refreshed, or opened a link in a new tab, silently lost
  the session with no indication — the banner just vanished. Now persisted to
  `sessionStorage` (cleared when the tab closes) and re-hydrated on load, with
  a guard so the header is only sent to the project it was started on.
- **Settings' write controls ignored View As entirely.** Only the dashboard's
  blocker form respected it; Save/Import/Delete on every Settings tab stayed
  live. All now disable while a session is active, as the server already
  enforced regardless.

Also added while writing the journey spec: a "View as" control on the
project home page and a Countries list with Delete on the Hierarchy tab —
neither had any UI before this, so neither flow (View As at all; hierarchy
delete) could be driven through the app.

### Flakiness

`playwright.config.js`: `workers: 2` (was effectively unbounded) and
`retries: 1` (was 0). Across the sweep rounds, full 4-project runs on this
machine produced a handful of timing failures — never the same test twice —
that always passed alone; the cause looks like this machine, not the app,
since nothing reproduced in isolation.

**Flaky tests from the final clean run:** none. The combined run (mock's
four projects + the new `real` project) passed everything on the first
attempt — 355 passed, 28 skipped (unchanged baseline), 0 failed, no retries
recorded.

**Later runs (record of tests that only passed on retry):**

| Date | Branch | Test | Notes |
|---|---|---|---|
| 2026-10-07 | `fix/hld-drag-test` | `sweep-round3.spec.js` › persistence across reload › "Reset demo data" discards the edit and restores the seed value (`desktop`) | flaky; a second full run was clean |
| 2026-10-08 | `feature/topology-icons` | same test (`tablet-portrait`) | flaky; passed on retry — root cause found and fixed, below |
| 2026-10-08 | `feature/m3a-catalogue-cmo` | `journey.spec.js` › the project appears in the list, and its building opens the real dashboard (`real`) | flaky; locator race, fixed. `getByText('LANspire')` also matched the sidebar's project link once the sidebar had loaded (strict-mode violation). Now scoped to `main`. The real project then passed 60/60 with `--repeat-each=4`, no retries |
| 2026-10-27 | `feature/dev-local` (PR #19 CI) | `e2e-real/survey.spec.js` › set up (`real`) | failed on both tries; locator race, fixed. `createProjectWithHierarchy` clicked "New project", which matches two links once the empty project list has rendered (the sidebar's + and the page's button); either opens the wizard, so it takes the first |
| 2026-10-27 | `feature/dev-local` (PR #19 CI) | `sweep-round3.spec.js` › persistence across reload › an edit on a building-scope survey tab survives a reload (`desktop`) | flaky; passed on retry. The first text input was read before the Storage Area form had loaded (the previous tab's, then replaced). Every Storage Area test there now waits for the tab's URL and its form; 132/132 with `--repeat-each=3`, no retries (with the survey spec) |

**"Reset demo data" — fixed (real bug, not a test problem).**
`resetDemoData()` (`client/src/lib/persistentStore.js`) cleared the
IndexedDB snapshot and then reloaded, but autosave stayed live in between.
The reload fires `pagehide` and `visibilitychange`, and both flush the
in-memory state, which still held the edit, back into the store that was
just cleared; an autosave tick in that window did the same. When one of
those writes committed before the page was torn down, the reloaded page
hydrated the edit instead of the seed. That meant Reset sometimes didn't
reset. Reproduced at 2 failures in 80 runs (`--repeat-each=40`, desktop +
tablet-portrait, no retries). Fix: once a reset starts, the autosave
interval is cleared and every flush path is a no-op (also checked after the
flush's database open, for one already in flight). After the fix: 80/80.
Test: `client/src/lib/persistentStore.test.js` reproduces the race
deterministically (a fake IndexedDB, with `reload` firing `pagehide` and
`visibilitychange` the way a real reload does) and fails with the guard
removed. The full combined run after the fix: 366 passed, 29 skipped, 0
failed, no retries.

**Stale test servers — now prevented.** On 2026-10-08 a `vite preview` left
over from an earlier run was still listening on 5173, and
`reuseExistingServer` made Playwright test that stale build: 9 deterministic
survey-form failures that disappeared once the process was killed. All
three webServers now have `reuseExistingServer: false`, and
`playwright.config.js` checks ports 5173, 4100 and 5174 before starting
(`client/playwright-support/assertPortsFree.mjs`, unit-tested). A busy port
stops the run in seconds with a message naming the port and how to find
and kill the process.

**M5b full run (2026-10-13): one flaky test, not fixed.**
`e2e-real/lld.spec.js` "the LLD, the Rackium Editor and the stock-length
settings fit every width" failed once and passed on its retry: the LLD
page's first load took more than the 5-second default of its
`not.toContainText('Loading…')` check while the mock-mode projects were
running in parallel. Two separate runs of the LLD spec passed (the test
took about 8 seconds, the page well inside the limit). Nothing in M5b
touches the LLD screen's loading; noted here so a repeat is recognised.
Full run: 419 passed, 29 skipped, 1 flaky, 0 failed.

*Follow-up (M5b review):* the LLD page load was measured (six loads each,
navigation → tabs shown and "Loading…" gone): **real mode** 482–1554 ms,
median 813 ms (first load the slowest); **mock mode** 743–1270 ms, median
862 ms — not slow. The measurement found every real-mode page fetching the
project list and the building dashboard **twice** (both sidebar rails loaded
their own data; fixed below): after the fix 6 API calls instead of 8, real
mode 481–800 ms, median 643 ms. The width test now waits for the page's own
ready state (`data-page-state="ready"`: the design and its validation
loaded, 30-second ceiling) instead of a fixed 5 seconds.

### CI

`.github/workflows/ci.yml` now runs Playwright (mock and real projects)
after the build step, with the Chromium browser cached by `actions/cache`
(keyed on the installed `@playwright/test` version) so a cache hit skips the
~100MB+ download and only reinstalls the OS packages, which is quick. Job
timeout raised from 45 to 60 minutes.

## Part 4: M3b — Physical Site Survey on the backend

Bugs found while building and testing M3b, each with the test that now
catches it:

- **Placing a CMO device wiped its serial.** The placement contract defaulted
  an omitted serial to `null`, so dragging a CMO device into a rack without
  restating the serial cleared it and its registry entry. Identity fields
  are now optional (omitted = keep), and an imported CMO serial cannot be
  changed from the rack. Test: `api.survey-structure.test.js` "placing a CMO
  device keeps its serial".
- **RU-state delete guard blocked racks forever.** Released RU states kept
  blocking rack deletion. The guard now counts active rows only
  (`registerDeleteGuard` filter).
- **Offline queue conflicted with itself.** Conflicts were detected per
  record, so every queued edit after the first (all sharing the base from
  when the tab was opened) was reported as overwriting the user's own edit.
  Conflicts are now field-level and only for changes by another user. Tests:
  `api.survey-forms.test.js` "the user's own queued edits sharing one base
  never conflict" and "removing a row a colleague changed … is a conflict".
- **Temporary ids for new rack items.** Undo could resurrect an identified
  device under a new temporary id, which then collided with itself on its
  serial. New items now get a client-chosen device id. Test:
  `api.survey-structure.test.js` "a new item keeps the id the client chose
  across saves, removal and undo".
- **Reused file id.** A client-chosen file id already used by another
  user's (or another tenant's) file returned that file's metadata, or a 500
  on the duplicate key. Now 409 `upload_exists`. Test: `api.files.test.js`
  "an id already used by someone else's file is refused".
- **Survey evidence removable after submission.** A Field Engineer could
  delete photos from a Submitted or Verified tab. Now refused until the tab
  is back in Draft. Test: `api.files.test.js` "a survey tab's photos cannot be
  removed once it is submitted".
- **Pathway distance lost when leaving the page.** The distance saves after
  a short typing pause; leaving within it dropped the value. The page now
  flushes the pending save on unmount. Test: `e2e-real/survey.spec.js`
  (structure step, "Regression: a distance typed just before leaving").
- **Too-broad console-error filter in the new e2e.** The survey spec first
  ignored every "Failed to load resource"; it now ignores network failures
  only while the network is deliberately cut, and collects errors only
  after sign-in.

Found, not fixed (reported):

- Mock mode's survey completeness never counts calculated "Must" fields
  (fixed in the shared engine used by real mode; mock left unchanged).
- ~~Existing M2/M3a endpoints (dashboard, CMO) do not enforce membership
  scopes yet~~ — fixed in the M3b review round below.

### M3b review round: membership scopes everywhere

Scopes are now enforced by one server helper (`server/src/access/scope.js`)
on the dashboard, blockers, CMO, project list and project home as well as
the survey. Found and fixed on the way, each with a test:

- **Dashboard, blockers and CMO ignored scopes.** A building-scoped user
  could open any building's dashboard, list and resolve its blockers, read
  the whole CMO inventory and (as a scoped PM) import into or assign
  devices to buildings outside their scope. Tests:
  `server/test/api.scope-enforcement.test.js` (dashboard, blockers, CMO,
  project list and home) and `client/e2e-real/scope.spec.js`.
- **An Org Admin with a scoped project membership was limited by it** on the
  survey endpoints. The Org Admin is never limited now. Test:
  `api.scope-enforcement.test.js` "Org Admin is never limited".
- **Blockers could be raised against any building id**, even one not in the
  project. Now 404. The M2 tests that used a made-up id now create a real
  building (`addBuilding` test helper).
- **The real dashboard hung on "Loading…"** (with an unhandled promise
  rejection) when the building could not be loaded. It now says the
  building is not in the part of the project the user can see, and the
  sidebar no longer throws. Test: `client/e2e-real/scope.spec.js`.
- **The CMO screen defaulted the import SAL to the building's own SAL**,
  which would have refused a building-scoped PM's whole import. It now
  offers only SALs within the caller's scope (covered by the server test's
  scoped-import case).

## Part 5: M4a — HLD on the backend

Found and fixed while building and testing M4a, each with a test:

- **`distinct` bypassed tenant scope.** The tenant plugin hooked find,
  count, update and delete but not `distinct`, so a `distinct` query would
  have returned values from every organisation (first used by the new HLD
  status code). `distinct` is now scoped and refused without a scope. Test:
  `server/test/tenancy.test.js` "distinct is scoped".
- **A Generate with nothing to add still claimed a revision**, which would
  have made a colleague's next save "stale" for no change. It now writes
  nothing. Test: `api.hld.test.js` (generate twice → same revision).
- **Edit Uplink kept a hidden stale optic.** After Change Medium the SFP
  selects show only optics for the new medium, but the old optic stayed in
  the draft and would have been saved invisibly. Real mode now drops optics
  that no longer fit. Test: `client/e2e-real/hld.spec.js` (wizard flow).
- **Test isolation gap in the new HLD isolation test**: a swallowed invite
  error meant the cross-project check could silently never run; it now
  runs unconditionally (`api.hld.test.js` "another project …").

Expectation updates (intended changes, not regressions): the infrastructure
catalogue group now includes the placeholder environment sensor, and the
organisation settings response now carries the naming codes.

### M4a review round: blueprint variants and VAL-005 from the catalogue

- **New seed fields never reached existing databases.** The platform seed
  only inserted missing items, so `requiresDualPsu` on the C9500 would have
  existed only in fresh databases. The seed now fills a field an existing
  seeded item lacks, still never changing a stored value. Test:
  `api.catalogue.test.js` "fills in a field an existing seeded item lacks".
- **Generated devices had no rack**, although the brief's templates suggest
  rack assignments (v2.2 §3.6A, AC-11). Devices now get a suggested rack
  (no RU); a rack without a PDU then raises VAL-003, as it should. Tests:
  AC-11 in `shared/src/hldRules.test.js` and `api.hld.test.js`, and
  "VAL-003: a planned device in a suggested rack with no PDU".

## Part 6: M4b — LLD, Rackium Editor and design versions

Found and fixed while building and testing M4b, each with a test:

- **The main LLD layer is project-wide, but clearing it was not scoped to the
  building.** Restore and promote cleared port occupancy and retired cable IDs
  for the whole `lld` layer, which would have wiped every other building's
  LLD registries. Clearing now works through the building's own connections
  and devices. Test: `api.lld.test.js` (concurrent IDs across two buildings,
  restore and promote cases).
- **A branch and the main LLD could both take the same new cable ID.** Each
  claims its own revision and the unique index is per layer, so a plain read
  of the main registry raced. New branch IDs are now also claimed in the main
  registry, where the unique index decides. Test: `api.lld.test.js` "a branch
  and the main LLD writing at the same time cannot both take a new ID".
- **A branch could take an ID the main LLD gave to a different cable.** The
  "inherited from main" allowance accepted any main connection of the
  building. Branch copies now record `originId` and may keep only their own
  cable's IDs. Test: same test, "keeps its own cable's IDs only".
- **The Physical Connections tab crashed in real mode**: the prototype NexAI
  analyser read blueprint suggestions the real topology does not have (blank
  page). It now tolerates their absence and takes the approved HLD's device
  count from the server. Test: `NexAiAnalyserPanel.test.jsx`.
- **A second LLD write clicked during the first one's reload was lost.** It
  went out with the old revision, was refused as stale, and the first
  write's reload then cleared the message. LLD writes are now queued, each
  using the revision the previous one produced. Tests:
  `client/src/lib/serialQueue.test.js`, `e2e-real/lld.spec.js` (Copy into
  LLD then Mark reviewed at once).
- **Rack elevation blocks covered the RU numbers** (existing bug, mock and
  real): blocks started at the face's left edge. They now start after the
  number column. Test: `RackElevation.test.jsx`.
- **Surveyed 0U gear (PDUs) was missing from LLD elevations**: the view did
  not carry `railSide`. Test: `api.lld.test.js` (rack elevations).
- **The editor's rack elevation was clipped at 1440 px** (two faces in a
  narrow column). The elevation has a `compact` one-face mode, used there.
  Test: `RackElevation.test.jsx` (compact).
- **The "Place" and "Add from catalogue" rows shared one Rack/RU/Face state**,
  so adding a panel moved the device form's values. Each row now has its
  own. Covered by `e2e-real/lld.spec.js` (placement then panel).
- **A patch-panel hop's suggestion button sat inside the port select's
  label** (invalid nesting: a click also activated the select). Moved out.
  Covered by `e2e-real/lld.spec.js` (hop suggestions).

### M4b review round: patch-panel sides by cable type

The panel side was direction-based (a hop came in at the rear, left at the
front). It is now set by cable type: patch cords (device↔panel) on the
front, trunks (panel↔panel) on the rear, the same whichever end the route is
drawn from. Found while changing it, each with a test:

- **Direction-based sides booked different ports for the same physical
  route drawn from the other end**, so a route redrawn in reverse could pass
  or clash differently. Sides now come from the neighbours only. Tests:
  `shared/src/lldDesign.test.js` (two-panel and single-panel routes both
  ways), `api.lld.test.js` "Patch-panel sides by cable type".
- **A pass-through hop could use the front of one port and the rear of
  another**, which do not connect. Refused (and `L-HOP` in validation).
  Tests: same files, "refused: … front and rear of different ports".
- **The Editor's out-port suggestion offered the port just picked for the
  in side** of a single-panel hop. Suggestions now count the draft's own
  picks as taken. Tests: `client/src/api/m4b.api.test.js` (port choices),
  `e2e-real/lld.spec.js` (Suggested: 02).

### M4b review round 2: panel labels and one connection per panel port

- **Panel labels repeated across rooms** (`PP-R01-01` in every room's
  first rack), so schedules and exports could not tell two panels apart.
  Default labels are now `PP-<room>-<rack>-NN`, unique per building, and a
  repeated custom label is refused. Tests: `shared/src/lldDesign.test.js`
  (labels), `api.lld.test.js` "default labels are room-qualified …".
- **A panel port's front and rear could be split over two connections**,
  fragmenting the trace. Refused (400) in the shared check and the API, and
  guarded by a pair row in the occupancy registry against racing saves;
  legacy pre-occupied cabling stays exempt. Tests: `lldDesign.test.js`
  ("one connection per panel port"), `api.lld.test.js` ("a split is
  refused", "the pair row is the guarantee"), `client m4b.api.test.js`.

## Part 7: M5a — BOM, Solution Package, client approval and change requests

Found and fixed while building and testing M5a, each with a test:

- **Branch copies took new ids, so a branch looked entirely different from
  its main design** (existing since M4b): the main-vs-branch diff listed every
  device and cable as removed and re-added, and promoting a branch replaced
  every id — which would orphan procurement lines and make the BOM look
  completely changed after a change request. Devices now record `originId`
  like connections; diffs and promotion use the main ids. Tests:
  `api.lld.test.js` (branch diff shows only the real change; ids survive the
  promotion), `api.m5a.test.js` (CR impact lists only the changed cable).
- **The BOM saw no prices**: the design's catalogue is read without prices,
  so every line was "Not priced". The BOM now reads prices and strips them
  per caller. Test: `api.m5a.test.js` (Draft BOM prices for the PM, none for
  the Architect, Field Engineer and Viewer).
- **New catalogue fields were dropped on read** (`stock`, `powerCord`), so
  cables and cords could not be matched. Test: same, plus the power-cord test.
- **A PDU socket type would have become 0** in the rack survey form (the PDU
  fields were all treated as counts) and was dropped when the counts changed.
  Test: `client/src/api/m3b.api.test.js` (factPatch).
- **A quick second edit in a Required Inputs list wiped the first**: each
  save sent the whole list built from what was on screen, so a VLAN saved a
  moment earlier was overwritten by the CIDR save. List edits now apply to
  the latest loaded package when the queued save runs. Tests:
  `client/src/api/m5a.api.test.js` (editList), `e2e-real/m5a.spec.js`
  (group 1 typed in the browser).
- **A pending-length cable was flagged "Not priced in the catalogue"**; it
  now says "Length pending". Test: `api.m5a.test.js` (price notes).
- **The public page looked the project up organisation-wide** (the project
  model is organisation-scoped), so with several projects it could name the
  wrong one. It now loads the link's own project. Test: `api.m5a.test.js`
  (hashed secrets: another project of the organisation comes first).
- **Test runs left their in-memory databases on disk** (since M1): 85
  `mongo-mem-*` folders (16 GB) in the system temp folder filled drive C:,
  after which `mongod` could not start and every API test was reported as
  *skipped*, not failed. Two causes: Playwright force-kills the real-mode e2e
  server on Windows, so it never stopped its database; and a crashed or
  interrupted Vitest worker never ran its `afterAll`. Databases now live under
  `<temp>/rackium-test-db/run-*`, are stopped with the library's forced
  cleanup, are removed by a Vitest global setup/teardown and a Playwright
  global teardown (which shuts the e2e server down cleanly first), and runs
  that died are swept at the start of the next run (only when their process
  has gone). `npm run clean:test-db` does the same by hand. Tests:
  `server/test/testDbCleanup.test.js`,
  `client/playwright-support/globalTeardown.test.mjs`.

### M5a review round: HLD in change requests, cables per segment, cage nuts

Found and fixed, each with a test:

- **The survey's rack statistics counted planned design devices** (since
  M4a): the Comms Rooms Summary's used/free RU counted every device in the
  rack — the HLD's, the LLD's and every branch's copies — so placing a device
  in the LLD (or opening a change request, which copies the HLD) changed the
  surveyed "used RU". It now counts the surveyed gear only. Test:
  `api.m5a-review.test.js` (rack statistics).
- **A connection end without a port was labelled "… null"** (since M4b) in
  the cable schedule, e.g. right after the LLD starts or for a link a change
  request adds. It now shows the device alone. Test: `shared/lldModel.test.js`
  (endLabel).
- **An LLD-only change request wrote a new frozen HLD version** (found while
  building): approval now promotes the branch's HLD only when the change
  touched it. Test: `api.m5a.test.js` (the cable CR keeps the HLD versions).
- **Promoting a change request's HLD failed on its own new records** (found
  while building): a device new on the branch comes back under its own id,
  which the branch copy still held (duplicate key). Branch records are now
  removed before the main ones are re-created. Test: `api.m5a-review.test.js`
  (a CR adds a device in the HLD).
- **The design diff ignored PSU counts**: an HLD change of a device's
  configured PSUs did not count as a change. Test:
  `shared/m5a.test.js` (the design diff lists a PSU count change).
- **The e2e server's database could still be left behind** (found in this
  round's full run): the Playwright teardown returned once the server's port
  closed, while the process was still removing its database; Playwright then
  force-killed it half-way. The teardown now waits for the process itself to
  exit (the shutdown reply carries its pid). Test:
  `client/playwright-support/globalTeardown.test.mjs` (waits for the process).

## Part 8: M5b — Tasks, notifications and the audit log

Found and fixed while building and testing M5b, each with a test:

- **Task edits recorded no role in the audit** (found while building): the
  task update and delete routes did not load the caller's roles, so the
  audit entry's role was empty. Test: `api.m5b.test.js` (audit detail shows
  the Field Engineer's role).
- **CR-branch banner wording** (M5a review leftover): the LLD page said a
  change request's branch is "promoted"; it now says the change is applied on
  client approval. Test: `e2e-real/m5a.spec.js` (the CR branch banner).

- **Accepting an invitation could fail with a 500 under load** (since M1;
  found as an intermittent failure of the full server run): the driver
  retries a transaction's callback after a transient error (a write
  conflict); the callback had set the new user outside itself, so the retry
  skipped creating the user and the membership pointed at nobody. Each
  attempt now works on its own user, and only the committed one is kept. A
  scan of every transaction callback found no other assignment to an
  outside variable. Test: `api.transaction-retry.test.js` (one simulated
  write conflict during acceptance).

Interpretations to confirm are marked ★ in DATA-MODEL §5.11.1 and §8.3.

### M5b review round: time zone, grouping, Reviewer audit access, the LLD load

Found and fixed, each with a test:

- **Every real-mode page loaded the sidebar's data twice** (since M2): the
  desktop rail and the tablet icon rail are both mounted (CSS hides one) and
  each fetched the project list and the building dashboard. Loaded once now
  and passed to both. Test: `e2e-real/m5b.spec.js` (one request each).
- **The audit log never loaded for a PM, Architect or Reviewer who applied
  filters before the project list arrived** (found while testing the
  Reviewer's access): the filters went out without a project and the
  start-up step that picks one had already been skipped. The project is now
  filled in when the list arrives, and Apply waits for it. Test:
  `e2e-real/m5b.spec.js` (the Reviewer filters straight away).

## Part 9: M6a — Deployment & Installation and the CMDB on the backend

Found and fixed while building and testing M6a, each with a test:

- **A state conflict answered as "forbidden"** (found while building): the
  deployment service turned every rule message starting with "Only…" into a
  403, so accepting a connection whose test had failed ("Only a tested
  connection…") looked like a permission problem. The message now names the
  missing step and comes back as a 409. Test: `api.m6a.test.js` (accepting a
  faulty link is a 409 naming the link test).
- **CMDB operational edits failed with a 500** (found while testing): the
  CMDB audit helper never passed the action, so the audit entry did not
  validate and the edit rolled back. Test: `api.m6a.test.js` (operational
  edits, audited as operational changes).
- **The lifecycle import refused a device that appears on two rows** (found
  while testing): one row with the warranty and another with the refresh
  date were treated as a conflict. Only two different dates for the same
  field are refused now. Test: `api.m6a.test.js` (lifecycle import: serial
  row and hostname row for the same switch).
- **Design values showed a lowercase "design" badge** (found in the real-mode
  run): design provenance carried no label. Test: `api.m6a.test.js` (label
  and freeze date) and `e2e-real/m6a.spec.js` (the badge in the record).
- **The DGUV form was offered to Reviewers**, who may not record an
  inspection (found while reviewing the screen): the view now says who may
  record it and the form follows. Test: `api.m6a.test.js` (permissions in the
  view, Reviewer refused).
- **A WAN circuit with no stored category would have been "installed"**
  (found while reviewing): carrier gear is now recognised by its role as
  well. Test: `shared/src/deployment.test.js` (delivery gating line).
- **BUG-SWEEP Part 8 lost a test file name** (a shell edit in the M5b round
  ate the backticks): restored (`api.transaction-retry.test.js`).

Decisions to confirm are marked ★ in the M6a report and described in
DATA-MODEL §4.11, §4.12, §5.2, §5.3, §8.2 and §8.3.

### M6a review round: connection counts, retired records, uninspected devices

Found and fixed, each with a test:

- **The dashboard always showed 0 connections** (since M2): the count was a
  placeholder. It now counts the building's designed connections and,
  from their records, how many are installed, tested and accepted. Test:
  `api.m6a.test.js` (dashboard after patching and tests) and
  `e2e-real/m6a.spec.js` (the Connections tile).
- **A device removed by an approved change request kept its serial
  reserved** (M6a): its installation record stayed behind with the serial in
  the project registry and the MAC in the unique index. It is retired in the
  same transaction now — serial and MAC released, open exceptions closed,
  audited, and listed in the CMDB change log. Test: `api.m6a.test.js` (the
  released serial and MAC installed on another device) and
  `e2e-real/m6a.spec.js` (the retired record in the change log).
- **Installed but never inspected devices got no DGUV reminder** (M6a): the
  job only looked at recorded inspections. A "not inspected" reminder now
  goes to the PMs once per device, and the dashboard shows a DGUV summary.
  Test: `api.m6a.test.js` (reminders, once) and `e2e-real/m6a.spec.js`
  (the summary).

## Part 10: M6b — Document engine and handover on the backend

Found and fixed while building and testing M6b, each with a test:

- **A large lifecycle import was refused** (M6a): the CMDB lifecycle import
  posts the parsed sheet as JSON, but its route was not in the list allowed
  a large body, so a sheet of a few thousand rows hit the 100 KB limit (413).
  Test: `api.m6b.test.js` (3,000 rows; a logo above the limit too).
- **The handover package was counted as one of its own documents** (found
  while testing): the package ZIP carries the compile round, so the round
  showed 13 of 12 files and the baseline would have listed the package twice.
  Test: `api.m6b.test.js` (12 files, baseline of 12 documents).
- **The Handover page stopped updating while compiling** (found in the
  real-mode run): its refresh re-armed only when the count of ready files
  changed, so two refreshes with the same count ended it and the page stayed
  on "Compiling". It now refreshes on an interval while compiling. Test:
  `e2e-real/m6b.spec.js` (compile → Compiled without reloading).
- **Missing logos logged 404s in the console** (found in the real-mode run):
  the settings screens asked for a logo that was not set. The settings now
  say whether a logo exists. Test: `e2e-real/m6b.spec.js` (no console errors).
- **The handover table hid its download buttons on a phone** (found
  checking 390 px): a stacked list replaced the table. Test:
  `e2e-real/m6b.spec.js` (no horizontal overflow at every width).
- **One crashed document job could stop the queue** (found reviewing the
  processor): each job now runs isolated; its lock expires and it is retried.
  Test: `api.m6b.test.js` (a corrupt job ahead of a good one; the test fails
  without the fix).
- **The handover showed Compiled before its package existed** (found in the
  full run): the round was marked Compiled and the package ZIP attached
  afterwards, so the screen stopped refreshing without the package link. The
  round is now claimed, the package built, and Compiled set together with it.
  Test: `api.m6b.test.js` (Compiled with its package) and
  `e2e-real/m6b.spec.js` (the package link after compiling, no reload).
- **Two older checks expected the export stubs** (M5a and LLD specs): the
  Solution Package's disabled Export PDF/Word buttons are now the live
  Documents menu, and a generic "Export" label clashed with the cable
  schedule's own Export button — the menu is labelled "Documents".

Decisions to confirm are marked ★ in the M6b report and described in
DATA-MODEL §5.12.

### M6b review round: cost prices, survey tables, the PDF test isolation

Found and fixed, each with a test:

- **Cost prices could reach a client** (M6b): any user who could see prices
  could export the BOM at cost and put that file in a download link. Cost
  mode is now internal only: the Org Admin, PM and Reviewer request, list and
  download it; every PDF page, the Word header and every sheet say
  "INTERNAL — cost prices"; a download link refuses it (400), a public link
  never lists or serves it even if its record names it, and a handover job or
  package with cost prices is refused. The BOM menu offers "client price"
  exports and, for those three roles, separate "INTERNAL" items. Tests:
  `api.m6b.test.js` (role refusals, the mark on every page and sheet, the
  share-link refusal, a forced link, the handover refusal) and
  `e2e-real/m6b.spec.js` (Reviewer export marked on every page; no cost item
  for the Architect; the menu at four widths).
- **The survey report printed "N row(s)" instead of the survey tables**
  (M6b): table sections and item lists now print as full tables with their
  columns (a Rack column where rows belong to racks); long tables continue
  across pages with the headings repeated. Tests: `documents.test.js`
  (assembly) and `api.m6b.test.js` (90 rows across pages, headings on each).
- **Photos beyond the 120 cap were dropped silently** (M6b): the document
  now says how many further photos are in the photo evidence ZIP, at the
  start and where they were cut. Test: `documents.test.js`.
- **The survey-forms API tests timed out in the full server run** (M6b):
  every test file paid for loading the PDF and Office renderers on import,
  and the PDF tests ran headless Chromium in the same run. The renderers now
  load on first use, and `npm run test:server` runs the PDF tests
  (`api.m6b.test.js`) in a second Vitest process after all other files —
  no reruns.

- **A timed-out test could write into the next test's data** (found in the
  full server run): `api.m5b.test.js` failed twice under heavy load on the
  machine — the blockers test ran past its 60 s timeout, kept sending
  requests while the next test ran, and the DGUV/mention test then saw its
  notifications. Notification fan-out is awaited in the request, so the app
  was not at fault; the tests were not isolated. Each test's apps now belong
  to it: once it ends or times out they refuse requests, writes from its
  in-flight work are refused at the driver, and the next test waits until its
  requests are done. Test: `isolation.test.js` (a timed-out fixture test
  that keeps calling the API and has a request in flight: nothing reaches
  the next test; without the isolation 15 users leak in, so the check is
  real).
- **A test command's exit code was hidden by a pipe** (in this round's own
  run): the server suite's output was filtered through grep and the shell
  reported exit 0 with two failed tests. CLAUDE.md now requires the real exit
  code (full log to a file, then filter).

- **CI failed: the document tests had no Chromium** (PR #13, the first CI
  run of M6b's PDF tests): the workflow installed the Playwright browser
  only after the server API tests, so every document job failed at the
  rendering step (12 of the 14 tests in `api.m6b.test.js`); locally the
  browser was already installed. The browser is now installed before the
  server tests, and a failed document job's reason is shown in the test
  failure instead of only "failed". Test: `ci-workflow.test.js` (the
  install steps come before the server tests; fails on the old order) —
  reproduced locally with no browser available, where the HLD test now
  reports "Executable doesn't exist".

- **A flaky Organisation settings check** (PR #13 CI: failed on the first
  attempt, passed on retry): "the Org Admin revokes it again; creation is
  refused" got 201 instead of 403. The settings toggles update the screen at
  once and save in the background (by design; a refusal restores the real
  state), and the test took the "Not allowed" label as proof the revoke was
  saved, then called the API before the save landed. The server reads the
  permission fresh on every request, so the app was not at fault. The spec
  now waits for each toggle's save to answer. Test: the revoke check now
  slows the save by 1 s — the old test fails every time with it (403
  expected, 201 received), the fixed one passes; no other real-mode spec acts
  on a toggle before its save.

Noted, not a bug: one client unit run during this round reported 22 files /
233 tests instead of 27 / 247. No client test file was removed or changed
(git), and the count could not be reproduced in five further runs (idle and
under the same load); every later run found all 27 files.

## Part 11: fix/cmo-naming-gaps — surveyed gear keeps its own names (before M7a)

From the CMO-vs-FMO naming report. Found and fixed, each with a test:

- **Surveyed panels of the same type blocked the LLD** (M4b): `L-PANEL-LABEL`
  compared every panel in the building by its label, and a surveyed panel's
  label is its library name ("24-port patch panel"), so two of them were a
  Critical finding the Architect could not fix — the LLD could not be
  submitted. Reproduced through the API first (409 `validation_blocked`, "24-port
  patch panel is used by 2 patch panels in this building"). Now the Critical
  check covers the design's own (planned) panels; a surveyed panel takes part
  only with a label recorded on site, and a planned panel with that label is a
  Warning (`L-PANEL-LABEL-EXISTING`); two surveyed panels are never compared.
  The Architect can rename a planned panel (Rack Elevations → Place devices),
  so every remaining panel-label finding is fixable from the UI. Tests:
  `api.cmo-naming.test.js` (two surveyed panels → the LLD submits; failed
  before the fix), the planned duplicate still Critical and fixed by renaming,
  the existing-label clash a Warning that does not block; `lldDesign.test.js`;
  `e2e-real/lld.spec.js` (rename in the UI).
- **A rack holding CMO devices imported into it could not be saved in the
  Rack Survey** (M3a/M3b, found writing this round's tests): a device
  imported with a rack and RU has no height, so the survey drew it as a
  0U-high rack item and every save was refused ("a rack-mounted item is at
  least 1U"); one imported with a rack but no RU sat at RU 0 with the same
  result. It now shows as 1U until surveyed, and one without an RU stays in
  the rack's CMO list, off the elevation, untouched by saves. Test:
  `api.cmo-naming.test.js` (fails without the fix).
- **Picking a CMO device in the Rack Survey replaced the placed item's
  label with the CMO hostname** (M3b): the label sets the kind and port count
  of a panel without a catalogue model, so a CMO-picked 48-port panel counted
  24 ports. The pick now keeps the label and pre-fills the existing label
  from the hostname instead. Test: `realSurveyModel.test.js`.
- **The CMO import preview hid the server's own refusal text** (M3a): a row
  outside the importer's scope showed an empty Issues cell. Test:
  `cmoModel.test.js` (`rowIssueText`).
- **A panel rename was not a design change in diffs** (found in the PR #14
  review): the design diff compared a device's hostname, role, model and
  placement but not its `label`, so once the design was frozen a change
  request whose only change was a panel rename was refused as "no change",
  and its impact — what the client approves — never showed a rename. The
  diff now compares `label` for devices without a hostname (panels, cable
  managers; a switch's label is display only — comparing it flagged every
  hostname rename twice, caught by `api.m5a.test.js`). Tests: `lldDesign.test.js`; `api.m6b.test.js`
  (rename through a change request: refused on the frozen LLD, the impact
  shows it, applied on approval; the deployment view, QR cable labels, the LLD
  document and the cable matrix generated afterwards read the new label,
  those generated before keep version and bytes — fails without the fix).
- **The PM could not rename a panel** (PR #14 review): the rename used the
  LLD edit permission (Architect only) instead of the rename rules
  (Architect or PM, as hostname renames). Now the rename rules, in the API
  and the UI (the PM chooses the panel; placing stays the Architect's).
  Tests: `api.cmo-naming.test.js` (Architect and PM rename; Reviewer, Field
  Engineer and Viewer 403; out of scope and another organisation 404;
  refused after handover and while submitted), `e2e-real/lld.spec.js`.
- **A flaky HLD width check** (full Playwright run: failed on the first
  attempt, passed on retry): "the HLD and naming settings fit every width"
  allowed a page load the default 5 s to stop showing "Loading…"; with the
  machine busy (the editor using a core) one HLD load took ~6 s — every
  request returned 200, `/me` alone took 2.9 s. The LLD's width check had
  the same weakness and was fixed by waiting for the page's own ready state
  (Part 3, M5b review follow-up); the HLD page now has `data-page-state` ("ready" once the design
  and its validation are loaded) and the check waits for it, up to 30 s. The
  same fixed 5 s wait after a page load in the M5a and scope width checks now
  allows 30 s. Test: with every HLD design load slowed by 6 s, the old check
  fails as in the run and the new one passes.

Gaps closed (v2.2 §3.5a): the CMO import stores the Floor column (checked
like room and rack), takes an optional Vendor column, and imports rows
without a serial marked "No serial" — picked from the CMO list in the Rack
Survey, never serial-validated. The Rack Survey records an optional
"Existing label / name" per item, shown instead of the library name wherever
surveyed items are listed. Not built, waiting on the client: an old → new
mapping, the ghost overlay, CMO/FMO terminology changes (DATA-MODEL §11).

## Part 12: M7a-1 — project schedule, milestones, dependencies and SLAs

New: targets with an optional start per building × phase, the Gantt (built
in-house; THIRD-PARTY), standard and custom milestones, dependencies between
buildings with the critical path across them, SLAs with status, alerts and a
burn-down, the building's primary Architect and Field Engineer, an
append-only phase history with a one-off backfill script (BACKEND-SETUP), and
the dashboard's next milestone. Dates are local days in the organisation's
time zone, tested across the DST changes in Berlin and New York.

Found and fixed while building it, each with a test:

- **Every schedule load on a project without settings failed** (500,
  `TenantScopeError`): the settings upsert wrote `organisationId` and
  `projectId` into the update, which the tenant plugin refuses. Now only
  `$setOnInsert` of the defaults. Test: `api.schedule.test.js` (a fresh
  project's schedule loads).
- **Phase history could not be written** (`TenantScopeError` on
  `insertMany`): rows lacked their organisation and project. Test:
  `api.schedule.test.js` (live history, backfill, reopen, append-only).
- **The API would not start** with the M7a-1 OpenAPI block (a duplicate
  identifier `S`). Test: `api.openapi-coverage.test.js`.
- **Gantt: a one-day bar showed a clipped glyph** (a phase with a target and
  no start, e.g. the first phase). The label now shows only when it fits; the
  tooltip and list keep the name. Test: `e2e-real/m7a1.spec.js`.
- **Gantt: the Today tag covered the week label and a project milestone.**
  The tag now sits in a taller header below the labels; project milestones are
  centred in their row. Test: `e2e-real/m7a1.spec.js` (no overlap at 1440,
  1024 and 768).
- **Phone list rows wrapped differently per phase** (dates on the name's
  line for short names, below for long ones). Now one layout: name, dates,
  status and risk on fixed lines. Checked in the 390 px screenshot.
- **The Milestones panel listed every undated standard milestone of every
  building** (ten per building). It now shows the dated ones; choosing a
  building lists all of its milestones to set their dates. Test:
  `e2e-real/m7a1.spec.js`.

- **The drag test dragged the page header** (full Playwright run, failed
  on both attempts; passed when the spec ran alone): after typing targets
  into the panel the page had scrolled, the bar sat under the sticky header,
  and the mouse drag selected the search box text instead. The spec now
  scrolls the bar into view before dragging (Org Admin and Architect). The
  overlap check first measured the whole tick column; it measures the tick
  label now, and fails with the earlier header layout.

- **Schedule alerts were sent at local midnight, not in the morning** (found
  in the PR #15 review): an overdue phase or a breached SLA was told the
  first job run after local midnight. They now wait until the
  organisation's local morning time (its digest time, default 07:00), the
  same day. Tests: `api.schedule.test.js` — "status, projection and burn-down
  …" (nothing at 06:59, all at 07:00, nothing more at 07:15 or 23:45) and
  "deadlines follow the organisation's time zone across DST …" (Berlin
  2026-10-25 and 2027-03-28, New York 2026-10-26 and 2026-11-01, a 09:30
  morning time); both fail without the fix.
- **The keyboard e2e typed dates in the wrong field order on another
  locale**: a date field's day/month/year order follows the operating
  system, not the page language. The spec finds the order with a probe date
  first, so it holds on Windows (dd/mm/yyyy) and Linux CI (mm/dd/yyyy).

Decisions waiting on the client (DATA-MODEL "Pending client confirmation"):
the SLA breach escalates to the organisation's Org Admins (as "owner"), and
DGUV exempt status (M7a-2).

## Part 13: M7a-2 — global search, DGUV dashboards, field help

New: the top bar's global search (DATA-MODEL §5.16: every kind the brief
lists, existing labels, MACs in any notation, panel ports; each result checked
with its screen's own access rule; no prices, branches or snapshots; indexes),
the DGUV compliance rollup with drill-down and CSV, the weekly DGUV digest as
the email side of the M6a reminders, and field help (placeholder defaults
from the survey hints, the Org Admin's plain text and stripped photos, the ⓘ
in the survey forms).

Found and fixed while building it, each with a test:

- **Search was too slow on a large project** (10,000 devices, 20,000
  connections): every lookup ran one after the other and every candidate's
  access was checked one by one — about 220 ms with no match, 705 ms for a MAC
  prefix with 50 results. Now the lookups run together, the cable scan uses
  the lower-case key, and candidates are ranked before their screens' access
  checks run in batches, only until 50 are accepted: medians 131–331 ms
  (target < 500 ms). Test: `api.search-perf.test.js` (numbers in
  `logs/search-perf.json`).
- **The top bar overflowed a 390 px phone** once the search icon was added
  (by 8 px, then 1.5 px). The icon sits with the other buttons, and in real
  mode the wordmark and the gaps are smaller on phones. Test:
  `e2e-real/m7a2.spec.js` (the phone page has no horizontal overflow; it
  failed before the fix).
- **No survey field with a template hint showed its ⓘ until a row was
  added**: all 37 hinted fields are table columns, and an empty table had no
  header. An empty table now lists its columns with their help (real mode
  only; mock mode unchanged). Test: `e2e-real/m7a2.spec.js` (the placeholder
  help of "Building SAL code/Name").
- **The help popover lost its button**: inside a table header it was clipped
  by the table's scroll area, and after a window resize it stayed where it
  was — the resize handler called `contains()` with the window and threw
  (an uncaught error the console check did not see). The popover is fixed to
  the viewport, follows its button on scroll and resize, and the spec now
  records page errors too. Test: `e2e-real/m7a2.spec.js` ("help next to its
  button" at every width; fails with the old handler).

Found, not fixed: while the DGUV page loads the next level, the previous
level's rows stay on screen and can be clicked again (harmless — it opens the
same place). Noted for the cleanup pass.

Not built, waiting on the client: a DGUV "exempt" status (DATA-MODEL §11).

## Part 14: M7a-3 — dashboards, workload, reports, analytics

New (DATA-MODEL §5.17): the project dashboard with its country/SAL rollup,
the organisation dashboard, the workload matrix, the seven standard reports
in the M6b engine (PDF, CSV, Excel), scheduled reports, and analytics (six
metrics with monthly trends). Everything is counted over the buildings the
caller can open; figures per person for the Org Admin and PM only; BOM
values for those who may see prices only.

Found and fixed, each with a test:

- **Test file stores were never removed** (before the branch, carried over
  from M7a-2): every test process stored uploads and generated documents in
  `<tmp>/rackium-test-files-<pid>` — 284 folders, 143 MB, deleted at the
  start of this branch. Each process's folder now lives inside the run's
  folder, is removed after every test file (also after failed or timed-out
  tests) and on exit; the run teardown and the sweep catch killed workers;
  `npm run clean:test-db` and the start of each run sweep the old folders.
  Tests: `testDbCleanup.test.js` (a child Vitest run with a failing and a
  timed-out test; child processes that end normally, throw, or call
  `process.exit`; the old-layout sweep) — three fail with the old helper.
- **The organisation dashboard could add another project's tasks to a named
  person's figures**: a PM in one project and Viewer in another would have
  seen the Field Engineer's task counts from both. Named rows now count only
  projects where the caller is the Org Admin or a PM. Test:
  `api.m7a3.test.js` ("the workload matrix …"; fails without the fix).
- **CSV and Excel reports did not say what they cover**: the coverage line
  ("Covers N building(s) — the buildings in your scope") and the key figures
  were only in the PDF. Both now start with a Summary sheet. Test:
  `api.m7a3.test.js` ("each is generated as CSV and Excel with the
  requester's scope").

Checked by removing the rule and seeing its test fail: a report readable
only by its requester; BOM values only with price visibility; named
cross-project figures only from projects where the caller is Org Admin or PM.

Decisions to confirm with the client (DATA-MODEL §11): the sixth analytics
metric (blocker resolution time) and the BOM accuracy variance definition.

## Part 15: M7b-1 — the client's answers (addendum v2.3)

The addendum (`docs/RACKIUM-BRIEF-v2.3-ADDENDUM.md`, converted from the PDF)
answered the open questions; this part builds the answers that change
existing features (DATA-MODEL §5.18): the External Reviewer, DGUV exemption,
BOM accuracy against the as-installed with the revision count apart, the SLA
escalation contact, and the save-time port conflict check. Its conflicts with
our v2.3 decisions and its later items are recorded in DATA-MODEL §11.

Found and fixed, each with a test (`api.m7b1.test.js`):

- **The margin went to every project member.** `GET /commercial-settings`
  returned the margin % to Architects (without the setting), Field Engineers
  and Viewers. Stripped for anyone who may not see prices. Test: "no price,
  cost, margin…" (the scan over every screen, for an Architect, a Field
  Engineer and a Viewer too).
- **A change request's cost went to every member and to the client.** Its
  BOM impact carried the cost before and after, returned to every member and
  on the client's public share-link view (the screens did not show it; the
  API sent it). Stripped for non-price roles and always on the public view.
  Same test; fails when the stripping is removed.
- **Two engineers patching the same link overwrote each other.** The
  deployment patching save had no version check (the design screens did).
  Now refused, naming the port and who changed it; two saves at once: one
  wins. Test: "Deployment: two Field Engineers…" (fails without the check).
- **Whether a BOM line had a price went to roles that may not see prices.**
  The BOM view stripped the amounts but kept each line's `priced` flag, its
  price note ("Priced in USD, not EUR"), the "Not priced" status, the
  currency, the unpriced-line count (a "not priced" tile on the External
  Reviewer's screen) and the "Not priced: n line(s)" calculation line. All
  stripped now; the line shows its plain status. Found on the External
  Reviewer's screenshot. Tests: `api.m5a.test.js` "…without prices" (Architect,
  Field Engineer, Viewer) and `e2e-real/m7b1.spec.js` (External Reviewer).
- **The PM never saw the DGUV exemption form** (caught by
  `e2e-real/m7b1.spec.js` before commit): the deployment page builds the
  panel's permissions itself and left out the new `overrideDguv`.
- **The DGUV status read "Validinspected …" / "Exempt— …"** in the
  deployment panel: the gap after the status was only a CSS margin, so the
  text (and a screen reader) ran the words together. A real space now. Tests:
  `e2e-real/m6a.spec.js` ("Valid inspected") and `e2e-real/m7b1.spec.js`.
- **Test harness: a spec could read the e2e emails file half-written**
  (`SyntaxError: Unexpected end of JSON input` in `m7a2.spec.js`'s set-up,
  older than this PR): two emails sent at once overlapped their writes, and a
  read during a write failed. The test server now writes one at a time and
  `lastEmailTo` retries on a partial file. Covered by the full real-mode run.
- **Test: `m6a.spec.js` "dashboard: connections counted…" was flaky** (passed
  on retry): its `heading.or(getByText('B001').first())` matched both the
  heading and the sidebar link once both rendered (strict mode). It waits for
  the heading alone now.
- **The first version of this PR's port-in-use check ignored saved but
  unconfirmed patching** (caught by its own test before commit): a link whose
  patching was saved as a draft did not hold its port. Counted now. Same test.

Checked by removing the rule and seeing its test fail: the patching version
check, the change-request cost stripping, the supplier/PO stripping for the
External Reviewer, the exempt device skipped by the DGUV reminders.

Decided while building (★ in DATA-MODEL §5.18): "approve where Reviewers
can" is design approval — the External Reviewer does not accept
installations; the catalogue `vendor` is the manufacturer (a
specification) and stays visible; procurement status and delivery dates stay
visible to the External Reviewer, supplier, PO number and notes do not.

Found, not changed: the Solution Package readiness area "BOM pricing — every
BOM line priced" still counts unpriced lines for every member who can open
the package. It is a completeness gate with no amounts, and hiding it would
change the package's readiness for those roles; left for the PR that reworks
the Solution Package view (addendum backlog, DATA-MODEL §11).

## Part 16: M7b-2 — renames through a change request, legacy hostname, reprint task

Built (DATA-MODEL §5.19; addendum v2.3 Q5): a device renamed through an
approved change request keeps its old name (`legacyHostname`, set once,
never changed), shown "old → new" wherever it appears, and the field team
gets a reprint-label task for the renamed devices that are installed.

Found and fixed, each with a test:

- **Cable labels cut long device names and lost the port.** Each end line was
  one line with an ellipsis; on the 63.5 × 38.1 mm stock the QR code leaves
  ~24 mm of text, so a full hostname already ended in "…" and its port went
  with it (older than this PR; the M6b test matched the old label by its
  prefix for that reason). Each end now wraps to up to four lines, breaking
  anywhere, so "old → new" and the port print whole on every stock (checked on
  the three stocks' PDFs). Test: `api.m7b2.test.js` "with a primary Field
  Engineer…" (the full name and the port, both ends of the switch).
- **The deployment location tree cut device names** ("E-DE-ERL-C01-…" on
  desktop): a renamed device's "old → new" was invisible on the checklist the
  engineer works through (older than this PR for long names). Device names
  wrap now. Test: `e2e-real/m7b2.spec.js` (the renamed device's name fits,
  at every width).
- **The reprint task's notification skipped the PM it fell to** (caught by its
  own test before commit): notifications leave out their actor, and the task
  named the sending PM as both. A system-created task has no actor now.
- **Search reported an old-name match as "Name"** (caught by its own test):
  generated devices keep the original name in their stored label too, and the
  label won the tie. The old hostname is matched first.
- **Test: the mock deployment duplicate-serial test clicked a device behind
  the open device panel on a phone** (failed both tries once tree names
  wrapped): on a phone the panel covers the list from 64 px down, and the
  one-line row used to scroll into the strip above it. The test goes back to
  the list first, as a user would; all four layouts pass.

Checked by removing the rule and seeing its test fail: the reprint task only
for installed devices, the model guard on `legacyHostname`.

Decided while building (★ in DATA-MODEL §5.19): `legacyHostname` is set for
every device whose name an approved change request changed (installed or
not — the client approved the old name); for gear named by its label (patch
panels) it keeps the old label; a rename before LLD approval keeps no old
name; the reprint task covers active devices and panels alike and, without a
primary Field Engineer, goes to the PM who sent the change request.

Found, not changed: on the LLD screens a long name is still cut in the device
picker cards and on the canvas (both older than this PR); a renamed device
shows "old → …" with its new name on the line below, so both names are
visible there. Left for the canvas work of PR 3.

## Backlog for the final cleanup

Known, harmless today, left for one cleanup pass before release:

- **Four `react(set-state-in-effect)` lint warnings added in M7a-1**
  (`client/src/components/schedule/SchedulePanels.jsx`), the same pattern as
  the existing pages' warnings: the Targets panel resets its date drafts
  (line 40) and its assignee choices (line 43) when the schedule reloads; the
  SLA panel clears the burn-down before loading another (line 302); the
  Settings panel resets its form when the saved settings change (line 394).
  Each re-syncs a local draft with fresh server data; the cleanup is to key
  the panel (or the form) on the data so React remounts it instead.
  Behaviour is covered by `e2e-real/m7a1.spec.js`, so the change can be
  checked against it.
- **DGUV dashboard: the previous level's rows stay clickable while the next
  level loads** (M7a-2): harmless (it opens the same place again); show a
  loading state over the table instead.
