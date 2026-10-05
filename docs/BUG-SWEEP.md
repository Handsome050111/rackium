# Bug sweep: M1 backend foundation

Scope: the M1 code on `feature/m1-backend` (shared policy and contracts, server
core, tenancy, auth, organisations, audit, OpenAPI, and the client real-mode
auth screens). Method: read every M1 route and service against its tests, run
the full test suite, and walk each auth flow for the cases the tests do not
cover. Items marked **fixed** have a regression test. Items marked **open** are
known and deliberately not fixed in M1; each has a suggested owner.

## Fixed in this sweep

| # | Severity | Problem | Fix | Test |
|---|---|---|---|---|
| 1 | High | An unverified user who accepted an invitation got a membership and tokens, but `/me` returned 401 because the account stayed `pending_verification`. | Accepting an invitation proves the address is theirs, so it now activates the account and sets `emailVerifiedAt`. | `accepting an invitation verifies an unverified existing account…` |
| 2 | Medium | `GET /orgs/:orgId/projects` returned every project in the organisation to any member, including viewers. | Org Admins see all projects. Everyone else sees only the projects they hold a membership in. | `a project list shows an ordinary member only their own projects…` |
| 3 | Medium | A PM could not invite anyone, so a PM had to ask an Org Admin to add each member to their own project. | New policy action `invite_project_members` (Org Admin and PM). A PM may invite only into a project where they hold the PM role. Organisation-level invitations stay Org Admin only. Validation runs before authorisation so the project id is known. | `a PM invites project members into their own project only`; `a reviewer, architect or viewer on a project cannot invite into it`; policy unit test |

Earlier in M1 (already covered by tests in the M1 commits): logout and password
reset did not end outstanding access tokens; reuse of a rotated refresh token
was logged even when the family had already been revoked; queries returned as
lazy values escaped the tenant scope.

## Open (not fixed in M1)

| # | Severity | Problem | Suggested owner / fix |
|---|---|---|---|
| A | Medium | If the verification email fails to send after sign-up commits, the account exists but the person never receives a link. Signing up again returns the same "accepted" reply, so they are stuck. | Add `POST /auth/verify-email/resend` (rate-limited, same reply whether or not the account exists). M1.7. |
| B | Medium | The same gap exists for invitations: if the invitation email fails after the row is written, the invitee cannot get the link. | Add invitation resend and revoke for Org Admins and the inviting PM. M1.7. |
| C | Low | Refresh rotation claims the old token before issuing the new one. A request arriving in that gap, using the access token just issued, can see no live session and get 401 once. | Issue the new token first, then revoke the old one in the same step. Low risk; fix with the rotation tests. |
| D | Medium | Rate limits are held in process memory. Two PM2 instances would each allow the full limit. | Keep one process for M1 (as planned). Before scaling out, move limits to a shared store. |
| E | Medium | `TRUST_PROXY` defaults to 0. Behind Nginx every client shares the proxy's IP, so one user's failed sign-ins lock out everyone. | Set `TRUST_PROXY=1` in the VPS environment. Add a production check that rejects 0 when `NODE_ENV=production`. |
| F | Low | Membership scopes (country, SAL, building ids) are not checked to exist or to belong to the organisation. | Validate once the hierarchy exists (M2). |
| G | Low | The invitation audit entry records the invitee's email address in plain text. | Keep it for the audit trail, but confirm retention with the client when the GDPR purge is built. |
| H | Info | Approval routes do not exist yet, so the "architect cannot approve own work" rule (`canApproveSubmission`) is not yet enforced by any endpoint. | M2 must call `canApproveSubmission` in every internal approval route, with a test per route. |
| I | Info | The development console email provider writes verification and reset links, including tokens, to the server log. Production refuses this provider (checked at startup). | None, as long as production config is used. Keep the startup check tested. |
| J | Info | CI runs lint, unit and API tests and the client build, but not the Playwright suite. | Add a Playwright job once the backend has a deploy target. |
| K | Info | Commit `38da5be` is titled "M1.3 follow-up" but contains the client real-mode work. | Message-only fix, to be agreed before rewriting the branch again. |

## Checked and found correct

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
