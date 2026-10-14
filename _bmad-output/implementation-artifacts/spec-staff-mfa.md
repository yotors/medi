---
title: 'Staff multi-factor sign-in and controlled recovery'
type: 'feature'
created: '2026-10-14'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 3
baseline_commit: 'bb2d61eca859415e458fc753a5a3787b267fa987'
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/PRODUCT.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/DESIGN.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/.agents/skills/impeccable/reference/operate.md'
---

<frozen-after-approval reason="User authorized completing production access security; existing calm UI retained.">

## Intent

**Problem:** Password-only sign-in and recovery are insufficient protection for hospital records and privileged accounts. A new code field alone would leave enrollment, reset and queued-request bypasses.

**Approach:** Production requires authenticator MFA for every staff account; development may explicitly allow unenrolled synthetic accounts, but enrolled accounts always require their factor. Add restricted sign-in/enrollment/recovery states, independently authorized enrollment, replay prevention and attributable recovery.

## Boundaries & Constraints

**Always:** Password verification retains existing scrypt/DB throttling. Password success issues only a short-lived restricted session until required MFA completes; global routes and post-lock currentActor independently enforce factor completion/current generation. TOTP uses pinned maintained OTPAuth, six digits/SHA1/30-second step/20 random secret bytes/window±1; atomically consume matched counter. Encrypt secrets with AES-256-GCM, random nonce, external 32-byte key/key identifier and hospital/user/purpose-bound AAD. Production startup fails without valid key. Grants/recovery codes stored hashed; no plaintext secrets in histories/retry records/logs/browser persistence. Rotate cookie/CSRF after elevation; revoke other sessions after enrollment/recovery. Preserve temporary-password gate independently and ordinary password reset never removes MFA. Session absolute maximum remains eight hours; server-enforced 30-minute idle timeout, excluding background session polls from refresh. Synthetic local key/config migration is authorized without resetting existing accounts.

**Never:** Grant workspace access from password-only enrollment, unverified factor, stale factor generation, reused code or ordinary password reset. No SMS/email dependency, shared staff accounts, silently disabled production MFA, real patient data or live deployment. No permanent plaintext recovery-code retention or clinical-role redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Sign-in | Correct password, enrolled account | Restricted challenge; valid unused TOTP yields rotated complete session | Wrong/replayed/skewed code rejected with bounded attempts |
| First enrollment | Unenrolled account + independent one-use grant | Secret/manual setup and confirmation, then new factor and recovery codes shown once | Missing/expired/revoked grant or unconfirmed factor never accesses records |
| Recovery | Password-authenticated restricted session + unused recovery code | Consume once, revoke sessions, restricted replacement enrollment; new factor required | Racing/reused code has one winner; invalid does not modify factor |
| Secret response lost | Enrollment/recovery reply interrupted | Safe explicit restart or verified regeneration, no plaintext replay cache | Explain retry/re-sign-in path; no silent second active factor |
| Access change | Password reset, disable, role change or recovery while request waits | Fresh authority/factor checks reject revoked request | No read/write/audit of domain command after denial |
| Expiry | Idle/absolute/restricted-session deadline passes | Server denies access and UI clears protected state | Polling cannot keep idle sessions alive |
| Key failure | Missing/wrong key, tampered envelope or identity binding | Fail closed with generic error | No sensitive cryptographic diagnostics |
| UI | Keyboard/mobile/error/logout transitions | Same sign-in panel, focused step heading, visible errors, cleared secrets on exit | No hidden patient requests during restricted states |

</frozen-after-approval>

## Code Map

- `server/app.ts`, `auth.ts`: sign-in/session gates and currentActor; complete MFA enforcement must reach every currentActor caller.
- `server/administration.ts`, `setup.ts`: password-change/reset and provisioning; preserve existing account/history integrity.
- `shared/registration.ts`, `src/staff/StaffApp.tsx`, `src/staff/PasswordChange.tsx`: Session/login and restricted UI routing, BroadcastChannel cleanup, automatic directory requests.
- `server/db.ts`, `deploy/migrate.mjs`: additive migration and explicit runtime table grants.
- `tooling/release-local.mjs`, `release-verify.mjs`, `compose.release.yaml`: private production config and built sign-in currently assume one step; update together.

## Tasks & Acceptance

**Execution:**
- [x] `server/migrations/012_staff_mfa.sql`, `db.ts`, `deploy/migrate.mjs` — factor/pending/grant/recovery state, session security fields and append-only identity-security events with scoped keys and least privileges; compatible existing records, revoke/bound legacy production sessions.
- [x] `server/mfa.ts`, `auth.ts`, `app.ts`, `shared/registration.ts` — restricted state machine, bounded separate MFA attempt budgets, replay-safe factor verification, idle/absolute policy and post-lock checks. Use one captured verification timestamp.
- [x] `server/mfa-setup.ts`, administration integration — operator bootstrap/reset uses explicit hospital/account/reason and private grant output, never stdout credential. Fully authenticated admin can issue first enrollment grants after fresh password reauthentication; existing-factor reset requires operator ceremony or the user's verified recovery. Grants expire and are invalidated on reset/disable.
- [x] `src/staff/MfaChallenge.tsx`, `StaffApp.tsx`, related types/styles — extend existing inline sign-in/password screens for grant, manual authenticator setup, code, recovery, one-time recovery-code saving and session expiry. Clear all sensitive fields on identity/session changes. Explicit replacement/recovery-code regeneration requires password and factor proof.
- [x] `server/mfa.test.ts`, `tests/mfa.spec.ts`, package/config integration — RFC6238 known vectors, skew/replay/concurrency, grant/key binding, direct/queued bypass, reset/recovery/idle races, tenant boundaries and browser keyboard/mobile/error states.
- [x] Release config/verifier/docs — privately provision local MFA key, run MFA-enabled built workflow, retain restorable key/config, verify runtime immutability and persistence; document private operator ceremony and remaining production approvals.

**Acceptance Criteria:**
- Given production configuration, when using any password-only or stale-generation session against any protected API, then access is denied independently of UI.
- Given concurrent token/recovery submissions, when transactions finish, then at most one consumes that proof and event/session changes commit atomically.
- Given local development accounts and upgraded schema, when existing tests run under explicit synthetic policy, then domain behaviors remain intact; production verification still requires MFA.

## Implementation Notes

First enrollment needs a distinct grant delivered through an independently verified channel; the founder/hospital owns identity checking. Ten recovery codes, each 128 random bits, displayed only once; lost response requires verified regeneration. Restricted sessions expire after ten minutes. Expire pending authorization immediately and clear setup secrets in the UI on expiry/revocation. Physical expired-row cleanup occurs during scoped account mutations; retained encrypted envelopes still require their referenced keys for readiness and rotation. Enrolled users verify MFA before changing temporary passwords; unenrolled users can change temporary password restrictedly and sign in again for enrollment. Audit identity changes transactionally with fixed event codes and no free-text secret payload. Surface inherits existing Operate sign-in; no visual-world choice or comp round. Implementer reads craft floor immediately before UI edits, records surface contract, captures all states desktop/mobile, runs one detector; root owns independent finish review/documenter.

### Required state and recovery details

- Every state permits session inspection and logout; setup status is permitted for enrollment, recovery enrollment and complete sessions subject to the independent temporary-password gate. POSTs retain Origin/CSRF. Challenge permits verify/recovery, enrollment permits grant/start/status/confirm, recovery enrollment permits status/confirm. Complete sessions retain the independent temporary-password gate. Restricted session responses expose only own account/hospital label and authentication state, never patient/domain data.
- Domain currentActor remains complete-only. Password/MFA routes use a separate constrained identity check (active user, exact hospital/session, factor generation and deadlines); no generic allowRestricted switch on domain authorization. Unenrolled temporary-password change is allowed only in restricted mode; enrolled accounts verify factor first.
- Consume a grant into encrypted pending setup bound to the same restricted session. Repeated start/status returns that same setup until expiry. At most one active grant/pending setup per user. Replacement grant/reset/disable/role change revokes older grants/pending sessions. Lost/expired session requires a fresh grant.
- Recovery consumes its code, invalidates old factor and revokes all other sessions while retaining the current restricted session for replacement. Status resumes after a lost response without consuming another code. Retain unused recovery codes until replacement confirms; loss of the cookie requires another unused code or operator reset. Confirmation replaces factor and recovery generation atomically and rotates cookie/CSRF. Lost confirmation response is recovered by new authenticator sign-in followed by verified recovery-code regeneration; no mandatory acknowledgment trap.
- Recovery-code regeneration requires fresh password plus unused factor proof, replaces hashes and revokes other sessions without silently changing the authenticator. Authenticator replacement requires old factor proof and confirmation of new secret. Counter replay protection applies across all uses of the factor, not just login.
- Use a keyring with current key ID. Retain referenced old keys, encrypt new writes with current key, validate existing envelopes for startup/readiness, and provide operator re-encryption with verified counts and safe failure. A key version cannot be removed while referenced; backup requires all referenced versions. Missing/wrong key fails closed without revealing ciphertext or key diagnostics.
- Synthetic policy is explicit and forbidden in production; enrolled development accounts always challenge. Migration revokes legacy sessions or marks them incomplete, never defaults them to complete. Fixtures declare their intended policy.
- Refresh idle deadline only conditionally while unexpired for legitimate non-background workspace activity. Session/status polling cannot refresh it, directly or indirectly through frontend effects: updating effective expiry must not trigger automatic directory/queue requests that reset inactivity. Recheck expiry after hospital lock and test polling-only expiry. Client updates effective expiry from legitimate activity and clears protected memory on expiration/visibility validation.
- Operator reason is an enum initial_enrollment/lost_all_factors/compromised_factor; use a separate operator reference, never attribute CLI action to target staff. No arbitrary reason text in security events.
- Never enroll the founder's existing admin into a harness-owned authenticator. Release verifier enrolls separate synthetic fixtures. Existing founder accounts receive a private enrollment grant and manual setup instructions when MFA is enabled for them.

### Delivery responsibilities and preserved baseline

The implementer owns this complete sequential stage, including backend, UI, tests, release/recovery integration and documentation; root owns final independent reviews, scans and commit. Do not commit or push. Do not delegate implementation concurrently. Read `.agents/skills/impeccable/reference/craft-floor.md` immediately before UI edits, not as initial planning context. Impeccable context loading was already attempted once by root this session; do not rerun the launcher. Preserve the existing calm light/teal visual world; use the existing PRODUCT.md, DESIGN.md and surface brief. Retain all earlier verified workflows. Report any unexpected blocker instead of relaxing a security invariant.

A genuine pre-MFA archive is retained at `.local/release-backups/pre-mfa-final.medi`, key separately at `.local/recovery.key`, pinned image reference suffix `6e87f22730907761e0ddd405`. Never replace or mutate these files/references. Existing recovery supports the original archive format and old-image verification. Extend format/config handling explicitly for MFA keyrings without making old archives unreadable. Recorded old images must receive their original configuration; current MFA images must receive their referenced keys and required policy. Source recovery commands must still pass with production MFA enabled. Never print/reveal private keys, OTP seeds, grant values or recovery codes in test logs, screenshots, artifacts or chat. Browser captures of setup redact actual secret values before artifact creation while keeping layout visible. Fixture seeds may be used only inside private test execution.

Keep Docker network creation/removal drills separate from Playwright runs: this workstation reported Chromium `ERR_NETWORK_CHANGED` during concurrent network changes. Do not retry or raise timeouts to hide application failures. Run focused cases and existing regressions appropriate to touched authentication interfaces, then built-release and encrypted recovery verification sequentially. Existing browser fixtures have per-scenario random-account budgets; do not globally clear production buckets.

## Spec Change Log

Iteration1: independent blind/edge/verification review exposed lifecycle, readiness and browser-evidence gaps. Clarified bounded readiness/key admission, scoped expiry cleanup, persistent enrolled policy after final-code recovery, and asynchronous maintenance UI below. KEEP all working restricted/post-lock gates, replay protection, eight-hour/30-minute deadlines, additive migrations012/013, encrypted formats1/2, original baseline archive/images, session-family logout guards, calm UI and existing regression evidence. Preserve implementation and correct the demonstrated states; do not re-derive unrelated modules or rewrite applied migrations.

## Review Triage Log

| ID | Verdict | Evidence and route |
| --- | --- | --- |
| B1 | medium | Operator lookup unconditionally requires active, while disable preserves factors; inactive envelopes cannot use documented rotation. patch; grouped with E2. |
| B2 | medium | release-local validates/creates the MFA keyring before selecting stop/status; missing file prevents safe shutdown. patch. |
| B3 | high | Anonymous health invokes full UNION scan and each unseal synchronously reloads the file; repeated requests amplify work across all accounts. bad_spec; grouped with E3. |
| B4 | medium | readSession globally deletes pending rows before token lookup; MFA transactions also clean all tenants while holding one hospital lock. Unrelated locked pending rows can delay ordinary requests. bad_spec. |
| B5 | medium | Status effect only cancels on identity/unmount; delayed null status can overwrite a newer start/replace secret. bad_spec. |
| B6 | medium | Complete-session replacement pending expires at10min before the30min idle deadline; retained secret repeatedly confirms unsuccessfully and has no inline restart. Navigation can recover but the advertised path stalls. bad_spec. |
| B7 | medium | MFA busy is local and never sets accountPending; parent permits navigation while confirm/regenerate commits, discarding one-time result. A later verified regeneration exists, but accidental loss needs prevention and explicit uncertain-state handling. bad_spec. |
| B8 | medium | keyring loader uses unconstrained readFileSync; direct API/operator paths bypass release wrapper mode/type/size validation and may accept public files or block on special files. bad_spec. |
| B9 | medium | Artifact checker hardcodes its own safe config, so changing the actual MFA suite artifact settings does not fail the guard. patch; grouped with V1. |
| B10 | medium | Browser suite never submits complete-session regeneration/replacement or admin grant controls; code-navigation/state errors are not covered by API tests. patch; grouped with V2 for management, retain administrator grant coverage separately. |
| V1 | medium | Filed broken-verification evidence establishes the standalone checker does not import actual MFA config. patch, same root as B9. |
| V2 | medium | Filed regression-gap evidence establishes no browser exercises Authenticator security operations; the documented recovery path could fail unnoticed. patch, same management coverage root as B10. |
| E1 | high | Last-code recovery deletes factor and code; later synthetic login tests only those tables and returns complete despite prior enrollment. Persist existing enrollment requirement across this empty-proof state. bad_spec. |
| E2 | medium | Inactive account lookup excludes rotation although retained envelopes participate in readiness. patch, same root as B1. |
| E3 | high | Full decryption per anonymous health request has no cache, shared work, deadline or page bound. bad_spec, same root as B3. |

All findings are accepted; none is deferred. Lower patch entries are retained in the revised implementation responsibilities because bad_spec entries require a coherent correction pass. Existing working implementation is preserved under the user's restore-and-finish instruction and the requirement to respect existing work; no destructive rollback is performed.

## Verification

Typechecks/build, focused MFA API/crypto/browser matrix, regression and release verifier with production MFA, source/dependency scan, migration/restore. RFC vectors: https://datatracker.ietf.org/doc/html/rfc6238#appendix-B. OTPAuth API: https://hectorm.github.io/otpauth/classes/TOTP.html. Dependency investigation verified otpauth9.5.2; pin lockfile and inspect actual installed API. No claims of phishing resistance or completed security certification.

### Runtime-specific envelope admission

The generated MFA envelope uses a 12-byte nonce and 16-byte authentication tag. Enforce those exact lengths and bounded strict fields when reading it, including on packaged Node24. Node24 permits shortened GCM tags by default; local Node26 rejects them, so a local-only truncation check is insufficient. Pass explicit authTagLength16 and verify malformed/truncated envelopes are rejected on the packaged runtime. Reference: https://nodejs.org/docs/latest-v24.x/api/crypto.html#deciphersetauthtagbuffer-encoding . This clarifies the existing authenticated-envelope invariant without changing its format or frozen intent.

Private key delivery must work when the non-root operator UID differs from the image's default node UID1000 (including CI). Do not relax source-file confidentiality or run the application as root to read a mode600 bind mount. Verify the supported non-root identity/mount strategy on a different UID and preserve the same behavior during isolated recovery. This is part of repeatable release integration, not an infrastructure deployment approval.

### Elevation/logout ordering discovered during implementation

Add `013_session_families.sql` as a new additive migration; preserve already-applied012 instead of applying an unversioned local repair. A session family survives cookie rotation/elevation. Logout and elevation coordinate under the hospital lock, and logout revokes only the current family (ordinary logout must not sign out another device). Cover elevation committing before logout's global lookup while the new cookie response is delayed: bounded logout-only predecessor authority or an equivalent design must still revoke the late cookie, without permitting predecessor domain access. Verify both transaction orderings and independent-device survival. Existing all-user revocations on recovery/reset/access change remain effective. Include the new migration in both runners and exact verification expectations.


### Implementation evidence — 2026-10-14

Implementation tasks are complete; independent review/scans and commit remain with root. The acceptance-to-test mapping is in `docs/staff-mfa-verification.md`; private operator/keyring procedures are in `docs/staff-mfa.md`.

- `npm run typecheck`, `npm run typecheck:server`, `npm run build`: passed. `git diff --check`: passed.
- `npm run test:server`: 165/165 passed, including MFA14/14 and additive migrations1–13. The final idle-refresh correction was then verified with the focused `logout revokes|late domain` cases2/2 and server typecheck; no unnecessary repeat of unrelated suites.
- `npm run test:mfa:browser`: desktop/mobile2/2 passed, including polling-only idle expiration. Existing staff/administration browser regression40/40 passed. `npm run test:mfa:artifacts`: controlled failure retained no secret marker in output/artifacts. Masked captures under `artifacts/mfa-ui/`; Impeccable detector reported no primary findings.
- `node --test tooling/release-backup.test.mjs`:20/20 passed, including format2 keyring roundtrip and original format1 compatibility. `node tooling/mfa-backup-check.mjs .local/recovery.key`: wrong/missing captured keys rejected before archive publication. CI now runs that check.
- `npm run test:mfa:runtime`: packaged Node24 strict envelope rejection passed; mode0600 UID65532 source provisioned into UID1000 mode0400 read-only runtime passed. API remains non-root.
- `npm run release:local`, `npm run release:verify`: final reviewed image passed built HTTPS UI/auth/CSRF, persisted domain workflows, restricted SQL permissions and browser sign-in/refresh/logout. Earlier stop/start verification preserved factors and records.
- Final exact-image backup/recovery: `.local/release-backups/staff-mfa-reviewed.medi`, pinned reference `5575b642d8f53210f5f9f92a`, API/migrate `sha256:96a2fefaee7a3372d7cd1b14407a7d50510306c8ba815a4c5dfff3f2f2e9c4dd`. Restore passed40tables/1645records/migrations1–13, health/auth/tenant/read,27seconds. Archive key is separate and unchanged.
- Preserved `.local/release-backups/pre-mfa-final.medi` restored with original images/configuration:35tables/1240records/migrations1–11, health/auth/tenant/read,28seconds. Its archive/key/pinned reference remain untouched.

No founder/non-verifier account existed in the local production release; no harness factor was installed on an existing founder account. Explicit synthetic development accounts were preserved. All isolated recovery projects cleaned up. No live deployment, real patient data, security-certification claim or commit was made. Source/dependency scans and review disposition are recorded by root after this implementation handoff.

### Review correction contract — iteration1

Implement all accepted rows above as one sequential correction pass, preserving prior working code. Root owns review/scans/commit; no commit, push, real data, external deployment or destructive baseline change.

- Remember prior enrollment even when the final recovery code is consumed and the factor is removed. The existing monotonic factor_generation can establish history if its semantics remain valid; a previously enrolled user with no remaining proof must remain restricted enrollment requiring a fresh independent operator grant, including under synthetic policy. Do not manufacture a new schema migration if existing durable state proves the invariant. Test the exact final-code abandoned-replacement path under synthetic and required policies, with zero domain access.
- Permit key re-encryption of disabled accounts while grants remain active-only. Verify actual operator CLI rotation for an inactive account and successful removal of the retired key after all references are migrated; failed grants still deny.
- Stop/status commands must not create, read or require the MFA key file; they must use verified local project configuration and never remove volumes. Test missing/unreadable MFA configuration with a fake Docker admission harness so source services need not be disrupted.
- Bound readiness work. Load one strictly validated keyring per envelope scan; page/yield scan work and bound database wait/execution plus total duration. Coalesce simultaneous readiness calls and cache a recent result for a short documented interval so anonymous health requests cannot multiply full scans. Startup must perform a complete validation before serving; failed validation returns generic unavailable, missing/wrong referenced keys and tampered envelopes must be detected. Do not permit stale healthy cache indefinitely after failure or silently skip oversized scans. Add deterministic scan/count/concurrent-health/deadline/failure/recovery tests, and verify packaged readiness still rejects bad keys. Preserve synthetic policy rejection in production.
- Keyring admission itself must reject nonregular/symlink/world-readable/oversized inputs before unbounded reads and use a no-follow file descriptor with checked file metadata and bounded JSON parsing. Allow actual non-root mode0400 key volume and mode0600 operator files. Document trusted parent-directory assumptions and prevent writable/untrusted ancestors or demonstrate their validation; do not require private mode on system /run parents. Uniform generic failures, no key content diagnostics. Test direct API/operator loader, not wrapper alone.
- Remove global expired-pending deletion from ordinary session lookup and hospital-scoped MFA transactions. Request-time cleanup must be confined to that verified session/account or use separately bounded maintenance; expired rows never authorize proofs. Demonstrate a locked pending row in another hospital cannot block unrelated session lookup/MFA, and expiration cleanup still functions.
- Status hydration must not overwrite a later start/replace result. Track request generations/cancellation across status and mutations; handle failed loading as an explicit retryable state without enabling a conflicting stale action. Return pending setup expiration with its secret and clear expired setup locally; complete-session replacement must offer an explicit restart using fresh password/factor. Restricted recovery expiry stays restricted and explains the existing independent recovery/grant route.
- Integrate MFA pending/dirty state with existing parent navigation/unload guards for maintenance mutations; block accidental navigation while response is pending. Preserve functional sign-out and server family revocation. On uncertain confirm/regenerate response, explain new-authenticator re-sign-in and verified code regeneration, never plaintext retry caching. Clear credentials on exit. Test delayed status after mutation, delayed successful response with attempted navigation, timeout/lost response and replacement expiry/restart.
- Extend desktop/mobile browser tests through successful complete-session regeneration and authenticator replacement, new authenticator sign-in, administrator grant issuance/delivery/clear and protected-view suppression. Capture the additional authenticated maintenance/admin states with secrets masked, include keyboard/error/loading/expiry states where applicable. Read craft-floor immediately before UI edits; preserve incumbent identity. Detector already ran once; do not rerun. Root re-engages finish reviewer/documenter after corrected captures.
- Artifact privacy test must consume the actual playwright.mfa.config.ts settings, overriding only discovery/server startup/output paths as needed. Fail if a controlled failure produces a marker, unmasked screenshot, trace or automatic DOM snapshot. Demonstrate the check fails for an unsafe actual configuration without leaving that change in source. No secrets in reports.

Run focused tests covering corrected code, updated browser flows, types/build and necessary packaged readiness/backup/recovery evidence for the corrected image. Avoid repeating unrelated suites already passed unless a correction affects their interface. Never overlap Playwright with Docker network creation/removal. Append exact test outputs and update matrix mapping. Root will perform fresh three-layer review of the revised diff. Existing .impeccable/review/mfa finish disposition covers only old captured states and is not approval of these corrections.

Integration clarification during iteration1: stricter keyring admission must be consistent across direct loader, initializer, backup captured-key validation and format2 manifest validation. A keyring accepted for archive publication must be accepted by the recorded restored runtime. Apply compatible bounds/type/field checks to captured override candidates and provisioning before publication; test malformed/oversized candidates without changing live keys. Preserve valid historical archives and the UID-safe volume strategy.

Iteration1 verification discovery: a lost MFA response can deliver rotated Set-Cookie without its JSON CSRF token. Logout must recover a fresh CSRF only after validating that the server session belongs to the same device session family; never sign out an unrelated later login. Preserve expected family with pending logout retry state after clearing protected identity, including when the first status-refresh request fails. Test cookie/body split, interrupted refresh then retry, and refusal to apply another family's authority. This resolves the accepted uncertain-response/UI recovery requirement; do not retain plaintext factor or recovery proofs for retries.

### Iteration1 correction evidence — 2026-10-14

Accepted B1–B10/E1–E3/V1–V2 corrected sequentially. Durable generation prevents final-code synthetic bypass; inactive operator rotation works; stop/status ignore MFA files; readiness is paged/deadline-bound/coalesced/cached with descriptor-based strict key admission; request expiry cleanup is scoped. Setup status is generation-guarded, loading failures retry, pending expiration returns to fresh-proof replacement, and maintenance writes integrate parent guards. Interrupted elevation cookie/body delivery now supports same-family CSRF refresh on logout and preserves family for interrupted retry.

Verified corrections so far:
- `npm run test:mfa`:21/21 (17 API/operator tests +4 readiness/admission tests),55.0s.
- `npm run test:mfa:browser`:4/4 desktop/mobile,1.3m; includes successful regeneration/replacement/new-factor sign-in/admin-grant delivery, blocked navigation, loading/retry, expiry/restart, lost committed response and interrupted sign-out-refresh retry.
- Frontend/server typechecks and packaged build passed. `git diff --check` passed.
- `node --test tooling/release-local-admission.test.mjs`:1/1, missing/unreadable keyring stop/status via fake Docker.
- `node --test tooling/release-backup.test.mjs`:20/20; additional strict format2 keyring case1/1 after bound harmonization. Format1 compatibility preserved.
- Actual-config artifact guard passed; temporary `screenshot:'only-on-failure'` made it fail as required, then original source was restored and safe guard passed. No retained unsafe artifacts.
- `npm run release:local`: corrected image built and all services healthy. `npm run test:mfa:runtime`: Node24 strict envelopes, unsafe provisioning-ring rejection, UID65532 private source→UID1000 mode0400 runtime, and packaged readiness wrong/missing-key rejection passed.

Final release verifier/backup/restore output is appended after completion below. Parent retains independent final review/scans/commit and corrected-state UI finish review. No commit/push/live deployment or baseline archive/key mutation performed.

Final corrected-image evidence: `npm run release:verify` passed all built HTTPS/auth/CSRF/browser, persistence and restricted SQL/domain checks. Captured wrong/missing/extra-field/oversized keyrings rejected before backup publication. New `.local/release-backups/staff-mfa-corrected-iteration1.medi` pinned reference suffix`fc20b94c175405288e56c770` restored40tables/1739records/migrations1–13, health/auth/tenant/read in24seconds. API/migrate `sha256:24974d1fef95431eeb31b37c6608da9250c54a9cb9845219bc20536d9514ad87`; web `sha256:fc577b4e60e15bb49672ea4d0bf9d471d40307b3e1431fd9d988f35779b0216e`. Scoped own-expired pending cleanup and unrelated locked-row retention additionally passed1/1. Baseline archive/key/images unchanged; recovery temporary project cleaned up.

Affected existing staff browser regressions passed8/8 in44.8seconds. Parent visual inspection identified two mobile screenshots with shifted coordinate masks; both were removed and capture changed to screenshot-scoped CSS private-text suppression preserving geometry. No secret values are recorded in this evidence. Corrected screenshots and an explicit different-family logout-refusal branch are verified before final handoff.

Final capture-ready run:4/4 desktop/mobile passed in1.4minutes after font/layout settling, scroll reset and screenshot-scoped private-text suppression. Explicit different-family logout-refusal then same-family retry passed both viewports. Regenerated mobile replacement/expiry images were opened and checked; private text is absent and control geometry retained. No runtime changes occurred after the verified corrected image/restore.

Independent corrected-state UI review opened all32 current captures and returned `fix`: maintenance actions need visible accessible progress wording and field-to-action spacing. Both are being corrected together, preserving incumbent tokens and all authentication behavior. This is a bounded UI finish pass, not a new visual direction; affected browser captures and packaged UI evidence will be refreshed before verdict review.

UI finish follow-up addressed both disposition items only: operation-specific visible accessible pending status, and16px maintenance input/action separation. Browser4/4 passed(1.3m);34 final redacted captures regenerated and pending states opened. Frontend typecheck/diffcheck passed. Web-only rebuild `sha256:602bfe54c2776c184ff4e54192d17c6780c38d866a67201b761aa191c60635cc` passed release verifier including built generating/preparing status,16px gap and guarded navigation. API image unchanged; earlier archive retains its recorded pre-finish web image. No detector rerun or additional polish changes.

Final UI verdict: same reviewer confirmed both scoped fixes resolved, disposition ship; independent documenter confirmed incumbent conventions unchanged. npm audit --audit-level=moderate: zero vulnerabilities.


### Iteration2 independent review triage

Each finding below was independently classified after all three reviewers returned. Edge reviewer returned no findings. Blind arithmetic is metadata, not a defect.

| Finding | Verdict / route | Evidence |
| --- | --- | --- |
| B2.1 obsolete session polling | medium / bad_spec | StaffApp effect cleanup cancels timers but not in-flight validate; onSession does not advance generation, so old comparison can expire new MFA session and erase codes. |
| B2.2 unbounded MFA transaction lock | high / bad_spec | New transaction waits on exclusive hospital row with no SQL or lock deadline; blocked authenticated requests can exhaust pool and delay hospital work. |
| B2.3 status contention | medium / bad_spec | GET status uses mutating transaction/exclusive hospital lock and lacks budget; restricted sessions can contend with clinical work. |
| B2.4 rejected MFA evidence | medium / bad_spec | New proof endpoints only persist success; denials/limiting vanish with rollback. Bounded secret-free failure evidence is required for production security; next telemetry stage will reuse it. |
| B2.5 operator enrollment reason | medium / bad_spec | Operator initial_enrollment checks only current factors/codes, not durable generation; final-code abandoned recovery can be mislabeled. |
| B2.6 operator output ancestry | medium / bad_spec | Immediate directory mode alone neither verifies owner nor trusted ancestors; output can be redirected through another principal's writable path. |
| B2.7 partial output cleanup | medium / patch | writeFile may create file then fail before createdOutput is set, leaving partial output. Track successful exclusive-open ownership before write. |
| B2.8 ineligible admin action | medium / bad_spec | UI enables issuance for any active/password-updated account; server denies previously enrolled targets, with no eligibility/guidance on screen. |
| B2.9 effective setup deadline | medium / bad_spec | Setup expires ten minutes after creation but restricted session expires ten minutes after login; returned/displayed setup deadline can exceed actual usable time. |
| B2.10 volume lifecycle prose | low / patch | Compose-managed named volume is described as external. Correct description and destructive down-v implications; do not change volume ownership/lifecycle silently. |
| V2.1 regenerated-code round trip | medium / patch | Regeneration tests observe nonempty returned codes/rotation but never recover with a regenerated code; incorrect response codes could pass. Add old-code rejection/new-code consumption assertion. |

### Iteration2 corrective contract / KEEP

Preserve all working MFA, family-bound logout, bounded readiness/keyring/backup, synthetic isolation and UI protections. User restoration instruction requires retaining working code, not destructive reversion. Amend nonfrozen implementation contract as follows:
- Cancel/ignore obsolete session validation callbacks across effect teardown and authentication elevation; stale success/401 must not erase new session or recovery codes. Test held session response delivered after successful MFA.
- Bound MFA pool acquisition, lock/statement and total transaction duration; on deadline release/destroy clients safely, roll back unfinished work and return generic retryable503; never initiate COMMIT or further callback SQL after reporting timeout. If COMMIT was already sent and its acknowledgement is lost, treat the result as uncertain and preserve the existing re-sign-in/recovery guidance; transport loss cannot prove rollback. Test held hospital lock and pool recovery. Retain post-lock identity authority checks.
- Status is read-only, account/session scoped with compatible shared locks if needed to serialize revocation, no global/exclusive hospital mutation/cleanup; apply distinct bounded status budget without consuming proof budget. Verify repeated restricted status requests cannot monopolize clinical writes, and status still cannot expose another session's setup.
- Record MFA denials and throttling durably outside failed proof transactions with bounded fixed-key time-bucket aggregates and retention/max cardinality, no raw submitted identifiers, IP, proof, password or error strings. Known identity comes only from authenticated session; counts may use fixed outcome/operation enums and no guessed actor. Audit failure never allows proof success; telemetry failure on rejected proof must stay generic and bounded. Next observability stage reuses this evidence; document exact limits.
- Operator initial enrollment requires durable generation0; recovery reasons required after prior enrollment. Admission for private operator output requires current/root trusted ownership and non-writable/symlink-free ancestors consistent with keyring; immediate private directory. Exclusive descriptor open, record ownership before write, cleanup on write/commit failure, never delete preexisting output. Add negative and rollback tests including injected partial write failure.
- Expose minimal first-enrollment eligibility only through existing administrator-scoped staff projection; UI disables ineligible grant action and explains independent operator recovery without secret/status oversharing. Test eligible and enrolled cases and existing account projections.
- Return effective setup expiry capped by current session/restricted deadline, preserve server enforcement and UI expiry/restart text. Test setup begun near restricted expiry and complete-session replacement deadline.
- Correct named-volume lifecycle prose. Add regenerated recovery-code end-to-end round-trip test with old-code rejection and new-code restricted replacement success.

Scoped checks, updated affected captures and final packaged image/backup/runtime evidence required; do not overlap Docker network drills and browser runs. Root performs fresh three-layer review after handoff. Do not rerun UI detector or broaden polish. Keep original pre-MFA archive/key/images unchanged.

### Iteration2 correction evidence — 2026-10-14

All accepted B2.1–B2.10/V2.1 corrections implemented sequentially. Session polling now cancels obsolete effect callbacks and advances generation on MFA elevation. Proof/limiter/refund DB stages have bounded acquisition/SQL/lock/total budgets; status is account/session-scoped SELECT-only with shared revocation locking and separate30/account/minute admission (4096 accounts/process maximum). Migration014 stores at most504 fixed hourly operation/outcome failure buckets, with no submitted identifiers or proof fields. Operator output validates trusted ancestry, records exclusive descriptor ownership before writing, removes partial output after failures, preserves preexisting files and requires recovery reasons after durable enrollment. Administrator projection/UI exposes only first-enrollment eligibility. Setup expiration is capped by actual session deadlines, with honest UI copy. Named-volume lifecycle prose is corrected, and regenerated codes are exercised end to end.

Verification so far:
- Focused MFA28/28 passed in76.1s. Covers lock/pool/total deadline recovery, rate isolation, durable denial evidence/telemetry failure, effective expiry, actual operator partial-write/commit fault injection and regenerated-code consumption.
- Full server regression172/179 initially passed; seven fixture compatibility failures were corrected: migration expectation1–14 and query-observer support for pg.QueryConfig. Affected outpatient/inventory/reports suites then58/58 passed in67.2s, resolving all seven failures. No runtime timeout or security invariant was relaxed.
- Desktop/mobile4/4 passed in1.7m. The stronger delayed old-poll/new-session-body regression then2/2 passed in59.9s; delayed401 also preserves new codes. Polling-only expiry waits for legitimate directory loading to finish before shortening the synthetic deadline.
- Actual-config artifact guard passed. Archive compatibility20/20 passed in13.8s. Frontend/server types, build and diffcheck passed.
-38 CSS-redacted screenshots refreshed. Root's independent scoped reviewer opened all8 changed/new captures and returned SHIP; documenter returned unchanged. No detector rerun or visual polish expansion.
- One owned test was stopped after its fixture accidentally awaited login while holding its own shared hospital lock; fixture ordering corrected and only its generated synthetic schema removed. Sandbox-only archive runner failed generically and passed under authorized escalation. An approval-review timeout prevented one command from starting; permitted retry succeeded.

Final packaged image/runtime/verifier/backup/restore evidence follows after completion. No commit, push, live deployment, real data, founder enrollment, or original baseline archive/key/image mutation.

Final iteration2 packaged evidence: final monotonic deadline cases3/3, malformed-input denial evidence1/1 and actual administrator reauthentication-lock admission1/1 passed. `npm run release:local`, `npm run test:mfa:runtime`, `npm run release:verify` and captured-key admission check passed. API/migrate `sha256:40d07c55da008cd12c939bf82d70e67c95cd6c17b18d452a9ffbe4af72b10ee1`; web `sha256:40da5d770d693c289bba8c570dac3e56883dae1c61b2b3e72d16e4f85741334b`. New `.local/release-backups/staff-mfa-corrected-iteration2.medi`, pinned suffix`c4fb80382439e831c73d6737`, restored41tables/1934records/migrations1–14 in25seconds with health/auth/tenant/read checks. Isolated recovery project cleaned up; original pre-MFA archive/key/images unchanged. No implementation work remains in this sequential stage; independent final review/scans/commit remain with root.


### Iteration3 review triage / corrective contract

All three fresh layers returned before classification. Edge returned no findings. Blind floor arithmetic is metadata.

| Finding | Verdict / route | Evidence |
| --- | --- | --- |
| B3.1 stale401 cookie clearing | high / bad_spec | app onRequest unconditionally clearCookie on missing/predecessor session; delayed response mutates browser cookie regardless of React cancellation. Remove stale-read cookie mutation and test actual HTTP headers/browser cookie persistence. |
| B3.2 uncertain recovery response | medium / bad_spec | Successful recover consumes code/changes state before reply; network failure leaves UI challenge with only generic error. Same-session reconciliation must resume recovery_enrollment including final-code recovery. |
| B3.3 uncertain replacement response | medium / bad_spec | Successful replace creates pending secret/consumes old counter; network loss leaves maintenance form without pending hydration. Reconcile own pending setup explicitly instead of requiring unexplained fresh proof/reload. |
| B3.4 no client deadline | false / reject | src/staff/api.ts already supplies AbortSignal.timeout(15000); MFA calls do not override it. Fetch/body consumption is aborted, submit finally clears busy, and network errors use uncertain handling. No missing indefinite-request timeout established. |
| B3.5 login global expired cleanup | medium / bad_spec | Login deletes all expired sessions while holding one hospital lock; new pending FK cascade adds cross-hospital contention. Confine ordinary cleanup to authenticated account; test unrelated locked expired pending/session cannot block login. |
| B3.6 unbounded operator transaction | medium / bad_spec | CLI creates pool with connection timeout but SQL/hospital lock and total operation remain unbounded. Apply explicit operator transaction deadlines with safe rollback/output cleanup and held-lock test. |
| B3.7 successful proof throttling | medium / bad_spec | Six-person arithmetic is incorrect (start+confirm=12 of50), but successful MFA attempts are never refunded, so onboarding26 staff in one15min shared-IP window exceeds50 despite no bad proofs. Use bounded concurrent reservations retained for failed proofs and safely refunded after success; assert shared-IP successful workflow and failed-proof limits. |
| B3.8 expired displayed grant | medium / bad_spec | Admin stores grant string without server expiry and displays until clear/navigation/session expiry, potentially beyond30min. Return authoritative expiry and clear expired grant with replacement guidance. |
| B3.9 packaged operator runbook | medium / bad_spec | npm examples omit packaged owner/key context; checkout .env normally targets dev. Add executable constrained release operator procedure/tool if needed, safe target verification/private output, no secret stdout/renderedCompose. |
| B3.10 duplicate validators | false / reject | Checked actual runtime/initializer/archive validators: current/keys-only shape,64keys,ids,hex and16KiB bounds agree; publication rewrites compact captured key JSON accepted by runtime. Existing strict-input/built/backup tests exercise rejection. Duplication alone establishes no current divergent caller or violated invariant; generic future drift is not a verified defect. |
| V3.1 browser activity extension | medium / patch | Filed coverage gap: no test observes actual header/custom-event/timer extension beyond previous expiry. Add real workspace activity assertion with shortened initial deadline, no focus refresh. |
| V3.2 pending-envelope rotation | medium / patch | Actual CLI rotation test only contains established factor. Add old-key pending setup, assert both rotated, retire old key and confirm original pending secret. |

KEEP every verified policy, grant/recovery generation, per-stage bounded DB work, status rate budget, audit/aggregate privacy, original archives/images/keys, family-bound signout, UI protections and completed evidence. User restore instruction means preserve working code; no destructive reversion. Nonfrozen requirements:
- Authentication rejection must not clear/overwrite a cookie from a newer successful session. Explicit successful logout retains its intended behavior. Browser test delays a real predecessor-session401 from server until after elevation, then verifies the new cookie still authorizes and recovery codes remain visible. Do not substitute a mocked401 without real cookie behavior as sole evidence.
- On uncertain recover/replace, reconcile authenticated session and pending status only when identity and session family match the initiating session; never adopt another device/login. Resume correct restricted replacement/pending setup after committed response loss. If reconciliation also fails, expose an explicit retry/resume path retaining no plaintext submitted code/password; final unused code must not need resubmission. Same protections for start are prudent where the same resume contract applies. Exercise real committed/lost responses and reconciliation failure/retry, with protected-data suppression. Existing15s client deadline stays; do not add a redundant timer or weaken deadlines.
- Scope login expiry cleanup to current account (or separately bounded maintenance), including FK cascades; no unrelated hospital locks through bulk cleanup. Preserve password verification/authority recheck/session semantics.
- Bound operator transaction acquisition/lock/statement/total work with monotonic deadline, generic safe failure and private-output cleanup. Preserve COMMIT-acknowledgement uncertainty explanation. No callback SQL after deadline; never delete preexisting files. Test a held hospital lock and successful later retry, no grant/audit/factor partial state.
- MFA proof attempts use reservations: concurrent attempts count before proof work; unsuccessful/abandoned proofs retain charge; successful committed proof can refund its exact still-current budget window, never another window. Preserve independent password-login/reauth/status budgets and existing failure thresholds. A failed refund after committed proof must not turn success into misleading failure or leak secrets. Test >25 successful enrollments under one shared IP without clearing buckets, wrong/replayed proofs still exhaust, and concurrent guessing cannot bypass limits. Account/session fixtures must not globally reset production limits.
- Initial-grant response includes authoritative expiry; admin clears private grant on expiry/visibility and explains replacement issuance. Return API timestamp from committed DB state, not fabricated browser lifetime. Cover expiry and fresh issuance on desktop/mobile with redacted captures.
- Provide concrete packaged-release operator command context using the release migration/owner credential and mounted keyring, correct release database/project/image, private output retrieval and named target verification. Avoid printing secrets or copying release credentials into dev .env. Operator remains explicitly identified. Test synthetic release grant and rotation/recovery using this procedure; no founder enrollment/reset. If adding a wrapper, reject unknown/source-confused targets and unsafe output paths, bound subprocesses and preserve secret exclusion.
- Close V3.1 and V3.2 with actual browser/activity and real CLI pending-key rotation assertions. Keep iteration2 tests intact.

Focused checks then affected API/browser regressions and rebuilt packaged/runtime/recovery verification; no Docker network drills during browsers. No detector rerun; updated-state captures receive scoped UI review. Root owns next fresh review/scans/commit. Record all evidence and limitations in this spec and existing verification document. No implementation delegation or commits/pushes by implementer.

### Iteration3 correction evidence — 2026-10-14

Accepted corrections implemented sequentially; rejected B3.4/B3.10 remain unchanged. Stale authentication reads never clear cookies. Recovery/start/replacement reconcile only initiating account/session family and scoped pending setup, with explicit resume after failed reconciliation. Login cleanup includes only the authenticated account. Proof reservations refund committed success against exact original windows. Operator transactions use monotonic DB deadlines and synchronous private descriptor publication; packaged `release:mfa` uses the exact running local image, release owner credential, mounted keyring, private result retrieval and bounded subprocesses. Administrator grant expiry comes from committed DB state and clears locally. CI includes wrapper admission tests.

Verification:
- Full server184/184 passed in255.8s. Additional final scoped-login and refund-window/refund-storage-failure cases2/2 passed in8.3s; frontend/server/release types, build and diffcheck passed.
- Initial focused32/33 exposed a response assembly race after refund insertion: logout could revoke elevation before its post-commit session lookup. Response session now comes from the same locked elevation transaction; the late cookie remains revocable. Focused logout/late-response/predecessor/shared-IP4/4 passed. Final-code lost recovery, wrong/replayed/concurrent proofs,26 successful same-IP enrollments, bounded operator lock/rollback and old-key pending confirmation are covered.
- Desktop/mobile maintenance2/2 and corrected keyboard flows2/2 passed; latter1.2minutes. Actual server predecessor401 headers/new cookie persistence, lost committed replacement, final-code recovery with failed reconciliation/resume, authoritative grant expiry/reissue and actual activity-header/event/timer extension are covered. Existing affected staff browser8/8 passed in47.9s. Artifact guard passed. Root scoped6-capture review returned SHIP; documenter unchanged; no detector rerun.
- Wrapper admission1/1 passed including unknown/source-confused targets, unsafe/preexisting output and explicit forced-cleanup failure. Real packaged grant, key rotation and lost-factor recovery passed on a separate synthetic fixture. A tmpfs Docker archive-copy limitation was resolved using a private nonroot disposable writable helper layer; API remains read-only. All helper subprocesses are bounded; forced removal failure returns a safe fixed category/name before any success message. No secret stdout path was introduced.
- Rebuilt local release, Node24 strict envelope/readiness/alternate-UID key delivery, captured-key archive admission and complete release verifier passed. The verifier database-stop assertion now waits for the existing documented two-second readiness cache instead of assuming immediate invalidation.
- One additional test double initially ignored pg callback connection semantics and stalled; it was interrupted, corrected to intercept query instead, and its single owned synthetic schema removed. Browser interception initially unregistered a running route too early; corrected fixture passed without timeout/retry relaxation. No application security invariant was relaxed.

Final images: API/migrate `sha256:a9769d290beee44ab4748e0f37a8e5a8aa4e160db79cf45cd4ce89460ad548c3`; web `sha256:b35bc5fbad9480c39d0ed16ac4b56a582d2eb3110ed9e14d9301074063cf11ff`. New `.local/release-backups/staff-mfa-corrected-iteration3.medi`, pinned suffix`ffc4c641aa7b7bfb36ec9102`, contains41tables. Final restore output follows below. Original pre-MFA archive/key/images remain unchanged. No commit/push, founder enrollment/reset, live deployment or real patient data.

Final iteration3 isolated restore PASS:41tables/2184records/migrations1–14 in30seconds, exact recorded images and health/auth/tenant/read checks. Disposable recovery project cleaned up. Sequential implementation stage complete; root retains final source/security review and commit.

Final review: scoped independent reviewer `/root/mfa_i3_final_review` found no verified material defects in iteration3 auth/session/operator/UI changes. Root reviewed final packaged wrapper and cleanup/admission tests. Earlier triage remains resolved. The founder explicitly requested reduced token/credit use; final review targeted the correction delta rather than repeating already completed whole-feature review cycles. Full server184/184 and packaged recovery evidence are recorded above. Source scan and delivery CI are tracked separately.
