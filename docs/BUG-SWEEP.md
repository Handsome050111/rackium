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

Earlier in M1 (covered by tests in the M1 commits): logout and password reset
did not end outstanding access tokens; reuse of a rotated refresh token was
logged even when the family had already been revoked; queries returned as lazy
values escaped the tenant scope.

### Open (not fixed in M1)

| # | Severity | Problem | Suggested owner / fix |
|---|---|---|---|
| C | Low | Refresh rotation claims the old token before issuing the new one. A request arriving in that gap, using the access token just issued, can see no live session and get 401 once. | Issue the new token first, then revoke the old one in the same step. Low risk; fix with the rotation tests. |
| D | Medium | Rate limits are held in process memory. Two PM2 instances would each allow the full limit. | Keep one process for M1 (as planned). Before scaling out, move limits to a shared store. |
| E | Medium | `TRUST_PROXY` defaults to 0. Behind Nginx every client shares the proxy's IP, so one user's failed sign-ins lock out everyone. | Set `TRUST_PROXY=1` in the VPS environment. Add a production check that rejects 0 when `NODE_ENV=production`. |
| F | Low | Membership scopes (country, SAL, building ids) are not checked to exist or to belong to the organisation. | Validate once the hierarchy exists (M2). |
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
| 6 | Major | Any unknown screen under a building (for example `/b/b001/no-such-screen`) showed "<phase> screen is built in a later step", which is unfinished text in front of a client. | Replaced with a "Page not found" view and a link back to the building overview. | `client/e2e/bug-sweep.spec.js` › unknown screens |
| 7 | Minor | The dashboard's "View full history" button had no handler and no target screen. | Restored as a link to a new Activity page (`/b/:id/activity`) listing the dashboard history, with an empty state. Spec v2.3 §7.2, client audit item 13. | `client/e2e/bug-sweep.spec.js` › top bar and dashboard controls open their targets |
| 8 | Minor | The top bar Notifications bell and Settings button had no handler. | Bell opens a notifications panel with All / Unread tabs and "No notifications yet" (real notifications come in M5). Settings opens a Settings page (`/b/:id/settings`) with Organisation, Members and Project settings. Members links to the Team page in real mode. Other sections say "Available soon". | `client/e2e/bug-sweep.spec.js` › top bar and dashboard controls open their targets |

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

### Not covered in this round

These were on the sweep list and are not verified yet. They are not known to be
broken.

- Role gating on building-scope tabs and on the LLD and Rackium Editor screens.
  The earlier sweep covered only the room survey screen, and only role
  visibility of controls.
- Persistence and "Reset demo data" across a reload, beyond the existing e2e tests.
- Phone touch flows beyond overflow checks (drag, tap targets).
- Offline survey sync in the browser (the unit tests cover the sync code).
- Demo guide interactions.
- Layout of the new Team page at each width. It shows only in real mode, so
  mock-mode Playwright cannot reach it; it is covered by client unit tests only.
