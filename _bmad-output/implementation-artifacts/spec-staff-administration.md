---
title: Hospital staff account administration
type: feature
created: 2026-10-13
status: done
route: dispatch
review_loop_iteration: 1
baseline_commit: fa4c6e33493e75c88efd77dd45a886655768382f
context: [AGENTS.md, PRODUCT.md, DESIGN.md]
---

<frozen-after-approval reason="User authorized continuing the full roadmap; staff administration is its next milestone">

## Intent

Hospital administrators need to onboard and manage named staff without a shell.
Add a hospital-scoped account directory, account creation, role/status changes,
credential reset, and attributable administrative history. Every staff member
can change their own password; new/reset credentials require replacement before
access to patient records. Preserve existing clinical authorship and data.

## Boundaries & Constraints

Always use existing opaque sessions, hospital boundaries, strict validation,
transactional audit and explicit retries. Preserve seven existing roles as
provisional policy. Admin operations require current-password verification and
bounded attempts; passwords/tokens never appear in logs, audit, history or URLs.
New/reset credentials are high-entropy temporary passwords, visible only in the
initiating browser's memory, and blocked from clinical access until changed.
Keep at least one active administrator; forbid self-deactivation/demotion through
the admin interface. Access removal revokes sessions. Repeated/stale submissions
must not duplicate accounts/audit or overwrite a newer change.

Never delete staff or clinical history, offer public registration, email recovery,
vendor-wide access, or imply MFA/production identity readiness. Existing CLI
bootstrap remains usable. This slice uses fictional development accounts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Onboard | Admin creates staff, shares temporary credential privately | Account listed; first login permits only password replacement/session/logout | Duplicate username gives safe conflict |
| Manage | Admin changes another user's role/status or resets credential | Atomic account revision, audit and session revocation; history keeps author | Stale revision returns conflict, never silent overwrite |
| Boundaries | Non-admin or other-hospital identifier | No listing/admin data/mutation; unknown tenant ID indistinguishable from missing | 403/404; CSRF/Origin required |
| Preserve admin | Self-removal or concurrent loss of final active admin | Denied; one active administrator remains | Helpful conflict without partial change |
| Retry | Lost response then identical key/body | Original result, one effect and audit | Same key/different command conflicts; no plaintext secret receipt |
| Credential | Wrong current password, weak new value, or stale reset session | Denied with bounded attempts; reset/replaced password cannot revive revoked sessions | No secret-bearing error; new password signs out old sessions |
| Race | Access revoked while a mutation waits for hospital lock or login verifies an old hash | Stale actor cannot commit or mint valid old-credential session afterwards | Recheck authorization/credential inside transaction |
| Browser | Dirty draft, uncertainty, load error, session loss | Preserve editable drafts; retry same uncertain command; block accidental navigation; clear secrets on session loss | Loading/retry/conflict states, keyboard/mobile usable |

</frozen-after-approval>

## Code Map

- `server/app.ts` owns authentication hooks, login and registration; `auth.ts`
  owns scrypt, rate buckets and session lookup. Reuse these; fix login/reset races.
- `server/outpatient.ts` writes lock the hospital row. Recheck current actor after
  lock so a waiting write cannot outlive privilege revocation.
- `server/db.ts`, `migrations/001–003`: additive migration registration. Do not edit
  applied SQL or replace local data. Existing staff audit requires patient IDs;
  administrative audit belongs in a separate hospital/account-scoped table.
- `server/setup.ts`: retain secure CLI bootstrap; no existing-account overwrite.
- `shared/registration.ts`: extend session capability for required password change.
- `src/staff/StaffApp.tsx`, `api.ts`, `staff.css`: existing navigation, session
  clearing, error conventions and teal design; new administration surface belongs here.
- `server/registration.test.ts`, `outpatient.test.ts`, `tests/browser-fixture.ts`:
  isolated-schema integration fixtures and guarded browser fixtures; preserve tests.

## Tasks & Acceptance

Review-derived implementation requirements:
- Exact GET account by UUID supports reload regardless of fuzzy search/page.
- History is bounded to25 entries with page/total and actor ID/username; UI pages.
- All privileged account reads take hospital SHARE lock and recheck session.
- Reauthentication has independent account/IP reservations; failed attempts keep
  their budget, successful verifications refund only their own reservation.
- Same-surface navigation is a no-op; generic visit navigation consumes no old
  check-in target; pending uncertainty survives429/temporary reauthentication.


**Execution:**
- [x] `shared/administration.ts`, `shared/registration.ts` — strict command/query
  contracts and public response types; no credential fields in account DTOs.
- [x] `server/migrations/004_staff_administration.sql`, `server/db.ts` — revisions,
  required-password flag, constrained admin audit and idempotency receipts.
- [x] `server/administration.ts`, `auth.ts`, `app.ts`, `outpatient.ts` — account
  operations, self password replacement and transaction-safe revocation checks.
- [x] `src/staff/StaffAdministration.tsx`, `PasswordChange.tsx`, `StaffApp.tsx`,
  `staff.css` — usable account directory, forms, confirmation and history.
- [x] `server/administration.test.ts`, `tests/administration.spec.ts`, package and
  Playwright configuration — all matrix rows, meaningful concurrency/rollback and
  role tests; desktop/mobile workflow, axe and keyboard checks.
- [x] `docs/staff-workspace.md`, `docs/readiness.md`, `docs/product-roadmap.md` —
  describe verified behavior and remaining identity/production limits.

**Acceptance Criteria:**
- Given two hospitals, when administrators manage accounts, then each sees and
  changes only its own staff and cannot retrieve credentials in lists/history.
- Given an account with authored records, when deactivated then reactivated,
  then history survives and old sessions stay invalid.
- Given a temporary credential, when its user signs in, then patient/visit/admin
  APIs remain unavailable until successful password replacement and new sign-in.
- Given overlapping access changes, login and clinical writes, when revocation
  commits, then stale authority cannot create later writes or usable sessions.
- Given desktop/mobile or keyboard operation, when creating/managing staff and
  changing passwords, then the journey completes with clear errors and no page overflow.

## Implementation Notes

The founder's explicit instruction to finish the roadmap authorizes implementation
without another spec approval. No unresolved user choice blocks this general
administration slice. Additive local synthetic migrations are authorized; external
deployment and clinical policy decisions are outside this milestone. Use a salted
slow verification hash for any receipt fingerprint containing credentials (not a
fast hash usable as a password verifier); exclude reauthentication credentials
from business payload identity. Retain the exact submitted temporary credential
in memory during uncertain retries; never regenerate it for the same key.

## Spec Change Log

- Review iteration1: re-derive staff read/reload/history and reauthentication
  contracts. Add exact hospital-scoped account lookup, history pagination and
  stable actor ID/username; privileged reads lock/recheck current authority.
  Reserve bounded reauthentication attempts independently of sign-in IP buckets;
  successful verifications release their reservation, failed attempts remain.
  This avoids blocking ordinary onboarding after ten correct passwords while
  keeping concurrent expensive verification bounded. These are implementation
  details of already authorized administration, not new product choices.
  KEEP: salted credential receipts, temporary-password gating, exact retries,
  role/tenant validation, last-admin/self-removal protections, transactional audit
  and revocation, UI design/accessibility, all passing tests. Preserve integrated
  configuration navigation. Re-derive only affected administration files from
  these contracts; other parallel slices are not reverted.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
| --- | --- | --- | --- |
| B1 | high | Retained checkInPatient is consumed on VisitWorkspace mount, so revisiting can create an unintended visit. | patch |
| B2 | high | Same-surface navigation clears dirty state without unmounting its credential/draft. | patch |
| B3 | high | 429 clears a previously uncertain command and its only temporary credential. | patch |
| B4 | medium | A definitive password rejection after transport uncertainty leaves inputs disabled. | patch |
| B5 | high | COMPOSE_PROJECT_NAME overrides the YAML project name and can select the development database service. | patch |
| B6 | medium | Missing private config regenerates incompatible passwords against an existing persisted volume. | patch |
| B7 | medium | Each successful administrative verification consumes the ten-attempt budget and shared login IP budget. | bad_spec |
| B8 | medium | Fuzzy first-page search is not an exact account lookup; stale account can be beyond page one. | bad_spec |
| B9 | medium | Account history grows without a response bound or pagination, degrading long-lived accounts. | bad_spec |
| B10 | medium | Duplicate actor display names cannot be distinguished by the existing history DTO. | bad_spec |
| B11 | medium | Runtime-role smoke lacks successful new administrative/configuration operations. | patch |
| E1 | high | Same verified stale check-in defect as B1. | patch |
| E2 | high | Same verified dirty-guard defect as B2. | patch |
| E3 | high | Same verified uncertain-credential loss as B3. | patch |
| E4 | medium | Same verified fuzzy account reload defect as B8. | bad_spec |
| E5 | high | Privileged reads do not serialize/recheck authority after hook authentication; revocation can commit first. | bad_spec |
| E6 | medium | Same verified lost-config recovery defect as B6. | patch |
| V1 | medium | Preverified coverage gap: neither changed outpatient write has a lock/revocation regression. | patch |
| V2 | medium | Preverified coverage gap duplicates B11, with concrete missing grants mutation. | patch |
| V3 | high | Patient FOR UPDATE requires UPDATE privilege, absent from runtime grants; existing hospital lock already serializes check-in. | patch |
| V4 | medium | Full server run confirmed legacy migration assertion still expects versions1–3 despite additive4–5. | patch |


| B2.1 | medium | Embedded LF passes new username validation but browser text input cannot submit it; strict control rejection and normalized length bounds are required. | patch |
| B2.2 | medium | Transaction-start timestamps can invert revision history after lock waits; revision is the authoritative account event order. | patch |
| B2.3 | high | A prior temporary credential remains displayed while a second reset invalidates it; pending reset must clear the obsolete credential. | patch |
| B2.4 | false | The form explicitly confirms apply role/status AND sign out existing sessions; password plus confirmation makes revocation an intentional action even for unchanged values. It is not a silent save side effect. | reject |
| B2.5 | medium | Department selector filters after first25rows, so inactive matches can hide active choices; search alone does not provide browsing beyond25 identical-name matches. | bad_spec |
| B2.6 | low | Creation dirty state omits a changed role before name/username entry; direct initial-value comparison fixes the demonstrated lost selection. | patch |
| B2.7 | medium | Create and back transitions remove their focused trigger without focusing the new heading; keyboard location is lost. | patch |
| B2.8 | medium | Verification overwrites its only credential file by truncation; interruption/disk-full can destroy saved synthetic access. | patch |
| B2.9 | medium | Restart check only asserts prior patient presence; newly introduced staff/configuration/clinical persisted IDs and receipts also need prior-run assertions. | patch |
| B2.10 | medium | Gateway withouthealthprobe lets Compose wait treat started as ready before HTTPS serves application. | patch |
| E2.1 | medium | Lowercasing100Turkish dotted-capital I expands to200codeunits after existing maxcheck; normalized output can violateDBlimit andreturn500. | patch |
| E2.2 | medium | Same verified truncating fixture write asB2.8. | patch |
| V2.1 | medium | Preverified gap: configuration read SHARE-lock/revocation code lacks racecoverage on list/detail/history. | patch |

## Verification

Run frontend/server type checks, unit/build checks, all server integration tests,
all staff browser suites, configured security scans and local restore verification.
Inspect desktop/mobile screenshots and perform the bounded Impeccable finish
review. Review the complete diff and resolve every substantive finding.

### Implementation verification — 2026-10-13

- Implemented all execution files above. Migration 004 is additive; existing CLI
  bootstrap, patient audit and authored outpatient records are preserved.
- `npm run typecheck` and `npm run typecheck:server`: passed, including subsequently
  integrated hospital configuration code.
- Isolated administration integration run: 8/9 initially passed; its only failure
  was a test incorrectly expecting administrator-only history in a clinician
  projection. The corrected authorship test passed independently. A strengthened
  concurrent identical-key onboarding/replay test also passed independently.
  Remaining cases passed: hospital/role/CSRF boundaries, credential gating/reset,
  stale revisions, competing administrators, transactional audit rollback,
  hospital-lock clinical-write and login-reset races, and bounded reauthentication.
- `npm run test:staff -- administration.spec.ts`: final complete run passed 6/6
  across desktop/mobile in 1.8 minutes. Covers keyboard onboarding, required
  replacement, role/status/reset/history, axe, no page overflow, lost-response
  exact retry, load recovery, draft guards, revision conflict recovery and clearing
  temporary credentials on session loss. No credentials are intentionally included
  in screenshots; exported captures clear temporary credentials first.
- Bounded visual inspection used `artifacts/staff-ui/{desktop,mobile}-staff-account.png`,
  `-staff-directory.png`, and `-password-change.png`. One correction widened the
  mobile name column and matched checkbox color to the existing teal. Recaptures
  confirm readable forms, contained table scrolling, visible errors and no page
  overflow. PRODUCT.md/DESIGN.md and existing typography/panel tokens remain the
  authority; no visual-system changes were needed. Impeccable's context launcher
  could not create its engine cache, so its documented direct-context fallback
  was used.
- Parent integration work owns the final combined server/browser suites,
  unit/build/security scans, restore verification and complete-diff review.
  Those gates are not claimed complete by this feature-level record.

### Review notes

- Temporary credentials are generated with browser cryptographic randomness and
  retained with the exact command/key during uncertain retries. Receipt payload
  fingerprints use salted slow scrypt; current-password reauthentication is not
  part of command identity. Receipts contain only a credential-free account DTO.
- Clinical writes recheck active session/role/password-change capability after
  the hospital row lock. Login compares the originally verified credential hash
  to the current hash under that same lock before creating a session.
- Successful self-password replacement revokes its initiating session too; a
  lost response can be resolved by unchanged retry or new-password sign-in,
  without reviving a revoked session.
- Production MFA, recovery, validated hospital role policy, external identity
  integration and clinical/production readiness remain explicitly out of scope.

### Integrated verification — 2026-10-13

- Frontend and server typechecks passed;14 unit tests passed; production build passed.
- Full API integration suite passed57/57 after review fixes (180.5s).
- Development restore check passed for17 tables, including schema, row counts
  and content digests, using an isolated disposable database.
- Built local release passed HTTPS/Origin/CSRF, session cookie/logout, registration
  and retry, staff create/replay/password replacement, restricted check-in/clinical
  writes, configuration create/update/replay/price history, denied runtime DDL and
  history rewrites, packaging exclusions, project override protection, lost-config
  protection, database-outage readiness/recovery and actual browser sign-in/refresh.
  The same checks passed after full stop/rebuild/restart with prior record retention.
- Final browser regression, independent re-review and source scan of all newly
  staged files remain pending at this checkpoint; do not infer their completion.

Review iteration2 resolutions are in progress. Department-picker changes are
recorded against the configuration spec; other findings are bounded corrections
and tests with no new product decision. Unchanged-role/status submission remains
an explicitly confirmed session-revocation action (B2.4 rejected).

### Second review corrections — 2026-10-13

All accepted second-review findings were corrected. Username controls and
normalized length are validated consistently across create/login/bootstrap;
staff history uses revisions and audit time follows lock acquisition. Starting a
new credential submission clears an obsolete displayed credential. Role-only
drafts retain navigation protection; create/back restores focus. Two API
regressions and six distinct desktop/mobile regression/onboarding cases passed.
The reset test's completion assertions use a bounded 15-second wait after
five-second timeouts under concurrent cryptographic load.

Fresh independent visual review disposition: **ship**, limited to the six
provided desktop/mobile account, directory and password-change captures. It
confirmed the established light/teal design and responsive forms; no approved
comp or new design direction was supplied or required for this extension.

Release corrections B2.8/B2.9/B2.10/E2.2 received a bounded independent static
review: all resolved. The strengthened verifier passed after rebuild and again
after full stop/start, checking prior-run digests for 13 record groups. Staged
Semgrep scanned 111 targets including all new administration/configuration and
release files, with zero findings; Trivy high/critical checks and npm audit passed.
The final complete API regression and configuration loopback review are pending
at this checkpoint.

### Final local milestone evidence — 2026-10-13

All accepted review findings are resolved. Complete API regression passed61/61
before the last configuration corrections; the final affected configuration
suite passed15/15 and the additive006 migration preservation test passed. The
original complete staff browser suite passed54/54; subsequent affected staff
regressions/onboarding passed six distinct desktop/mobile cases, and final
configuration browser tests passed12/12. Both typechecks and production image
compilation passed. Original14 unit tests passed; their source is unchanged.

Final built release verification passed before and after full stop/start with
migrations001–006, protected HTTPS/session/Origin/CSRF behavior, restricted SQL,
all supported synthetic workflows, 13 prior-run persistence groups and database
outage recovery. Latest logical restore matched schema/counts/digests for17
tables. Final Semgrep scanned112 targets with zero findings; configured Trivy
high/critical and npm audit checks passed. No credential files were staged.

Independent staff and bounded configuration-picker visual reviews returned
**ship**; final overlap-notice captures were checked at desktop/mobile sizes.
Design documentation check preserved the incumbent system. Two rare direct-SQL
configuration suggestions were rejected with reasons in the configuration
triage log; no accepted finding is deferred. GitHub verification is pending the
push of this milestone; local evidence does not imply a production release.
