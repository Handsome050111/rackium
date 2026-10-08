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

### CI

`.github/workflows/ci.yml` now runs Playwright (mock and real projects)
after the build step, with the Chromium browser cached by `actions/cache`
(keyed on the installed `@playwright/test` version) so a cache hit skips the
~100MB+ download and only reinstalls the OS packages, which is quick. Job
timeout raised from 45 to 60 minutes.
