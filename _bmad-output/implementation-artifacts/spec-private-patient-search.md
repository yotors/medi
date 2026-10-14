---
title: 'Private patient search with fresh read authority'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '32bdf68080e7694892b8e22faa519cca29ef57d4'
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/docs/security-evidence.md'
---

<frozen-after-approval reason="User authorized restoring tooling and completing production-readiness engineering.">

## Intent

**Problem:** Patient names, contact details and record numbers currently travel in search URLs. Patient-directory/detail reads also lack the post-lock authority check used by clinical reads, allowing stale authorization while revocation is pending.

**Approach:** Move directory and visit search into authenticated JSON POST bodies and serialize patient reads against access changes. Preserve existing user-visible search, paging and role projections. This is the first production-hardening stage, not completion of the commercial hospital product.

## Boundaries & Constraints

**Always:** Use existing exact Origin and session CSRF checks for POST searches. Validate strict JSON input and reject query parameters on new endpoints. Preserve 25-row paging, Unicode normalization, literal wildcard escaping, total/page metadata, hospital predicates and visit status/assignment filters. Recheck currentActor and password-change requirement after the hospital SHARE lock for patient search/detail. Use bounded contention with a generic retryable 503, release/rollback on errors. Keep domain writes and histories unchanged. Use fictional data only.

**Never:** Put search terms in paths, queries, local/session storage or diagnostics. Do not retain a legacy GET search fallback accepting q. Do not broaden provisional roles, invent clinical policy, reset credentials, change the visual design, expose services, purchase infrastructure or claim production approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Search | POST /api/patients/search or /api/visits/search with existing filter fields | Existing scoped results and paging from JSON body | Invalid/unknown fields, null bytes, oversized terms, invalid page/filter yield 400 |
| Private transport | Name/contact/MRN entered in either UI | POST fixed path, term only in JSON body | No GET fallback or retry containing term |
| Legacy reads | GET list route with q present | Reject q, including empty q; harmless existing page/status/assigned filters may remain supported | 400 with generic error |
| Session protection | Missing/stale session, wrong Origin/CSRF, temporary password | No patient data | Existing 401/403 semantics |
| Revocation race | Patient search/detail waits while account disabled, role/password changed or session revoked | Recheck after lock; no stale result | 401; count/result not delivered |
| Isolation | Patient id or search belongs to another hospital | No cross-hospital results | Detail 404; search empty |
| Contention | Hospital lock unavailable | No partial results, clean transaction | Bounded retryable 503 |
| Browser recovery | Rapid search/date-independent filter/page changes or logout while response delayed | Existing generation guards prevent stale result display | Existing retry/session handling retained |

</frozen-after-approval>

## Code Map

- `server/app.ts`: directory schema, patient projection and directory/detail routes; onRequest already enforces Origin/CSRF. Login and writes must remain unchanged.
- `server/outpatient.ts`: visit list schema/route, existing SHARE lock/currentActor and role projections; refactor route input handling without duplicating aggregate logic.
- `server/auth.ts`: currentActor checks current session, active staff and role. Reuse it under the hospital lock.
- `src/staff/StaffApp.tsx`, `VisitWorkspace.tsx`: request effects currently construct URLs; session contains csrfToken; preserve cancellation/generation behavior and rendering.
- `server/registration.test.ts`, `outpatient.test.ts`: existing search/paging/isolation cases; `administration.test.ts` provides blocked-read revocation test pattern.
- `tests/staff.spec.ts`, `outpatient.spec.ts`: browser search helper URLs and routes; add network-level assertions. Other callers must be searched before removing GET q.
- `tooling/release-verify.mjs`: built synthetic HTTPS verifier; extend to exercise both search bodies, denied legacy queries and runtime authority.

## Tasks & Acceptance

**Execution:**
- [x] `server/app.ts` and `server/outpatient.ts` — implement private search routes, reject GET q, add fresh patient read authority and bounded lock handling; share implementation between permitted list entry points.
- [x] `src/staff/StaffApp.tsx`, `VisitWorkspace.tsx` — use POST JSON with CSRF, preserving UI state and errors.
- [x] `server/registration.test.ts`, `outpatient.test.ts` — migrate legitimate search cases and add matrix security/race/invalid/contended cases.
- [x] `tests/staff.spec.ts`, `outpatient.spec.ts` — adapt helpers, assert no private URL leakage and correct paging/results, stale/logout behavior.
- [x] `tooling/release-verify.mjs` — verify private searches using restricted runtime and existing fixture, without printing private values.
- [x] `docs/security-evidence.md`, `staff-workspace.md` — document API change/evidence; leave unresolved MFA/operations/production gates explicit.

**Acceptance Criteria:**
- Given populated synthetic hospitals, when searching with every allowed role, then scope and existing projections remain unchanged and private terms appear only in request bodies.
- Given a read blocked by an access mutation, when the mutation commits, then directory and detail reads deny revoked authority before reading protected patient rows.
- Given the built release, when running its verifier, then source records remain unchanged by searches and all previous persistence/security checks pass.

## Implementation Notes

No schema migration or new dependency is expected. Repository investigation resolves implementation choices; deployment/hospital approval decisions are not prerequisites for this reversible stage. Broader hardening remains active work under the user authorization.

### Review correction requirements

- Map read connection-acquisition/database availability failure to generic retryable 503, including session lookup on entry to private reads. Verify more concurrent blocked reads than pool slots, recovery and no partial PHI. Preserve original domain status errors.
- Populate the POST/GET role projection comparison with catalog billing, pending corrected-result counts and role-projected assignments. Add natural session expiry while directory/search/detail waits for lock; visit POST revocation variants (disable/role/password/session) must reject.
- Assert exact request bodies for name/contact/MRN, pagination/status/assignment. Inspect a unique synthetic term across every browser request URL and browser storage while authenticated, not just after logout. Add literal backslash/combined wildcard fixtures.
- Exercise two concurrent pending corrections assigned to different clinicians via the actual browser POST queue: selecting me includes own and excludes other. Keep existing takeover and delayed-response behavior.

## Spec Change Log

Iteration 1: independent reviews exposed incomplete acquisition-overload handling and specific transport/authority/projection verification gaps. Re-derive only affected implementation and tests; preserve verified shared handlers, strict body/legacy rejection, hospital scoping, UI state guards and source-history verifier. Existing working changes are retained to avoid destructive reversion. No frozen intent changes.


## Review Triage Log

All three fresh review layers returned before triage. Full diff includes the specification, so content-level blindness is limited despite fresh contexts. Edge reviewer returned no findings.

| Finding | Verdict / evidence | Resolution |
| --- | --- | --- |
| Blind1 pool acquisition | medium: connect is outside try; default pool connection timeout becomes 500. Entry readSession can likewise fail before route under saturation. | Handle read availability with generic 503 and test saturation/recovery |
| Blind2 token effect dependency | false: StaffApp renders VisitWorkspace with key=session.csrfToken, forcing unmount and effect cleanup on token replacement; validation also clears changed identity. | No production change |
| Blind3 populated projection evidence | medium: new POST comparison uses an empty visit, leaving populated billing/correction/assignment projections unverified on new transport. | Populate fixture |
| Blind4 natural expiry wait | medium: deletion/role/status tests do not protect wall-clock expiry after lock wait from a transaction-time regression. | Add natural expiry wait test |
| Blind5 visit revocation variants | medium: new POST blocked-read case only deletes session. | Add disable/role/password gate cases |
| Blind6 exact browser payload | medium: q type alone misses wrong field/filter/page serialization; visible tests only partly cover it. | Assert exact relevant bodies |
| Blind7 privacy while signed in | medium: path-limited URL observation and post-logout storage check miss other URL and transient browser persistence leaks. | Unique marker across all URLs and live storage |
| Blind8 backslash escaping | medium: literal backslash escaping transport not directly verified despite explicit escaping invariant. | Matching/nonmatching backslash/wildcard cases |
| Verification1 assignment exclusion | medium: omitting assigned from POST body survives current single-assignee browser test and GET-only API evidence. | Add second reviewer pending item and verify exclusion |

Accepted findings group into read-availability handling and affected verification gaps (bad_spec outside frozen intent). No accepted finding deferred; effect-dependency claim refuted by actual caller key.


## Verification

Run frontend/server typechecks and build; affected API cases and staff/outpatient browser suites; full regression through final CI; source scan after staging; packaged release verifier. Read the entire diff and perform independent BMad reviews before commit. UI layout is unchanged; network/privacy behavior must be tested in the browser.


### Local implementation evidence — 2026-10-14

- Frontend/server typechecks and frontend production build passed; release verifier JavaScript syntax and `git diff --check` passed.
- Registration API suite: 21/21 passed. Outpatient API suite: 17/17 passed.
- After narrowing lock-wait detection to each test schema, all 5 new private-search security/race/contended cases passed again.
- Staff/outpatient browser suites: 34/34 passed across desktop and mobile, including private POST/CSRF/body assertions, paging, delayed searches, changed filters and logout recovery.
- Isolated packaged release rebuilt successfully; verifier passed twice, including the final strengthened source/history digest comparison around both searches, legacy query rejection, invalid CSRF and revoked-session denial. Existing persistence, restricted-grant, clinical, billing, inventory, reporting and database-outage checks passed.
- Caller scan found no legitimate remaining GET search caller using `q`; only rejection tests retain those requests. Domain writes, migrations, dependencies and visual layout were unchanged.
- Root handoff: independent BMad reviews, staged source scan and final CI remain to be recorded before commit. This evidence does not establish production approval; MFA, operations and hospital-policy gates remain open.

### Review iteration 1 correction evidence — 2026-10-14

- Read session lookup failures on private read entry and patient/visit read connection-acquisition failures now return generic `503 READ_UNAVAILABLE`. Existing domain errors remain unchanged. Real two-slot-pool tests submit eight blocked reads and separately exhaust slots after session lookup, checking no partial patient fields, cleanup and recovery.
- Populated POST/GET comparisons now include an issued catalog invoice, pending corrected result and role-projected reviewer assignment for all seven roles. New cases cover natural session expiry during directory/list/detail lock waits, visit POST disable/role/temporary-password changes, and literal backslash/combined wildcard matching and nonmatching fixtures.
- Browser cases assert exact name/contact/MRN, page/status/assignment bodies; inspect every observed request URL and storage while authenticated; and use two pending corrections assigned to different clinicians to prove own inclusion and other exclusion through the actual POST queue.
- `node --env-file-if-exists=.env --import tsx --test --test-name-pattern='private|natural wall-clock|patient search and detail|contended patient' server/registration.test.ts server/outpatient.test.ts`: **10/10 passed** (32.2s). Initial run exposed an earlier test's shared admin-session revocation; restored that test session, then the whole targeted selection passed.
- `npx playwright test --config=playwright.staff.config.ts staff.spec.ts outpatient.spec.ts clinical.spec.ts --grep 'pagination changes rows|private directory name|private queue name|laboratory correction reaches'`: **10/10 passed**, desktop/mobile (1.5m).
- `npm run typecheck`, `npm run typecheck:server`, and `git diff --check` passed. Full CI and fresh review remain with root; no commit or broader regression/release rerun performed in this correction iteration.

### Final local review and release evidence

Both independent follow-up reviewers found no remaining implementation or verification findings. Root inspected the production changes and affected tests. The rebuilt packaged HTTPS release verifier passed after iteration 1, including persistence, private searches, runtime grants, session denial and outage recovery. Staged Semgrep source scan passed: 150 targets, zero findings. Full regression CI is queued with the subsequent engineering delivery; it is not claimed passed for this revision. No accepted review finding deferred.
