---
title: Connected outpatient workflow
created: 2026-10-13
status: done
route: dispatch
baseline_commit: 9a12dfcfb49568290329bb6e1fba4ebccab359b6
context: [AGENTS.md, DESIGN.md, docs/staff-workspace.md]
---

<frozen-after-approval>
## Intent
Finish the first server-backed outpatient workflow inside `/staff`: registered patient → check-in → consultation → investigations/result review → prescription fulfillment → settlement → closed historical visit. User authorized continuing development and publishing to yotors/medi. This is a cohesive synthetic outpatient MVP, not a claim of complete hospital operations or live clinical readiness.

## Boundaries & Constraints
Preserve existing registration/authentication and original browser walkthrough. No browser state imports. Reuse existing domain transition rules; all writes occur on the server under hospital ownership, row locks, optimistic revision and idempotency. Every successful mutation appends an attributable server event atomically. One active visit per patient. Integer ETB, existing invented demonstration prices, no real payment processing. Released results/closed visits remain immutable. Clinical sign-off, actual tariffs, medication inventory, admissions, scheduling, insurance and deployment choices are subsequent validated scope.

Add clinician/lab/pharmacist/cashier to current roles. Receptionist/admin check in; clinician/admin notes/order/prescribe/review/cancel investigation/close; lab/admin collect/release; pharmacist/admin fulfill/cancel prescription; cashier/admin settle. Auditor read-only. Admin can demonstrate the full flow; this provisional role policy must be validated before clinical use.

Server responses project only role-authorized sections: receptionist summary only; clinician notes/orders/prescriptions; lab orders; pharmacist prescriptions; cashier charges/payments; auditor history; admin all. Summary includes patient identity, workflow status/pending counts/balance and closure blockers. Queue rows contain no clinical free text. Do not download all sections then hide them in CSS.

Unknown bodies/queries, invalid IDs/text/NUL rejected; inherit session/origin/CSRF checks. All mutations require UUID idempotency key; command also expected revision. Identical retries return one effect even after later revision advances; changed payload/key conflicts. Cross-hospital IDs404, wrong role403, stale revision409. No sensitive payloads in logs. Persist before UI changes. Uncertain saves retain same key/body and explicit retry, block navigation; stale conflicts reload latest without losing typed drafts. Session changes clear all clinical state/drafts.

## I/O & Edge-Case Matrix
| Scenario | Expected |
| --- | --- |
| concurrent check-ins | one active visit |
| repeated/concurrent payment or note key | one payment/note/event |
| stale command |409, no mutation |
| wrong hospital or role |404/403, no content or mutation |
| department reader |only allowed sections in JSON |
| unresolved visit closure |blocked with reasons |
| valid closed visit/restart |persistent read-only history |
| failed database/audit write |atomic rollback, retry succeeds |
</frozen-after-approval>

## Code Map / contract
Parent creates `shared/outpatient.ts` shared Zod request/type/permissions contract. It imports existing `src/domain.ts` for pure transitions/types; no domain behavior rewrite this slice. `server/app.ts` owns global session/origin hooks; expose its existing session WeakMap to a separately registered route function in `server/outpatient.ts`. `server/db.ts` migration runner must apply002 without modifying001 or truncating data. Existing registration tests remain.

API: POST `/api/patients/:id/visits` body`{}`+key → `{visit:VisitView}`; GET `/api/visits?q=&status=active|closed|all&page=1` → `{visits:VisitSummary[],total,page,pageSize:25}`; GET `/api/visits/:id` → `{visit:VisitView}`; POST `/api/visits/:id/commands` body`{expectedRevision,command}`+key → `{visit:VisitView}`. Command omits visitId (route authoritative); supported note/order/advanceOrder/prescribe/fulfill/settle/close, existing domain fields. Shared contract is authoritative; do not invent response fields independently.

## Tasks & Acceptance
- [x] `shared/outpatient.ts`, `shared/registration.ts` — roles, schemas, DTOs and explicit permissions (parent).
- [x] `server/outpatient.ts`, migrations002, `server/db.ts`, `server/app.ts`, `server/setup.ts`, `server/outpatient.test.ts` — durable encounters, projected APIs, migration and role support (backend builder).
- [x] `src/staff/StaffApp.tsx`, `VisitWorkspace.tsx`, `VisitPanel.tsx`, `staff.css`, `tests/outpatient.spec.ts` — queue, check-in from directory, visit forms/history and browser tests (UI builder).
- [x] scripts/CI + backup/restore check, documentation, local synthetic role accounts, GitHub verification (parent).

Given multiple staff roles/hospitals, when a visit completes across handoffs, then state persists and each user sees only authorized sections and actions. Given dropped responses/stale revisions, then retries neither duplicate actions nor silently overwrite work. Given desktop/mobile, when keyboard completes an admin synthetic journey, then dialogs/forms remain accessible and axe finds no tested violations. Given a database backup, when restored into a separate temporary database, then schema/record counts agree and source remains unchanged.

## Implementation Notes
No additional permission gates: user's explicit continuation authorizes local reversible work and repository push. No production deployment. Git main initial commit already pushed. Parent owns shared contract, docs/CI/backup; backend and UI builders have disjoint files. Backend builder owns server-only; UI builder owns src/staff and tests/outpatient.spec.ts only. Both read shared contract before implementing. No direct changes to original domain/demo. Leave commits/push to parent.

## Spec Change Log

- Review patch scope extends server migrations with additive003 because002 already
  exists in the local database; no data reset or rewrite of applied migrations.
  Shared HTTP contracts remain unchanged. Existing role projections, transactions,
  retry guarantees, domain behavior and calm UI composition must be preserved.


## Review Triage Log

All three BMad layers collected before triage. Blind and edge reviews used fresh
agents; the thread limit required reusing the prior independent verification
reviewer with explicit instructions to discard earlier conclusions. Impeccable
fresh visual/documentation review returned `disposition: ship` for all four
full-page desktop/mobile visit/history captures; no material visual fixes.

| Finding | Verdict and evidence | Route |
| --- | --- | --- |
| Blind1: no ordinary visit refresh | medium: detail stays stale after a department handoff; navigating away loses draft context. Add refresh preserving draft. | patch |
| Blind2: hidden conflicting result draft | medium: released/cancelled order removes editable textarea after stale reload. Expose retained unsaved text read-only. | patch |
| Blind3: unsaved draft navigation loss | medium: unmounting VisitPanel destroys unsubmitted text. Add dirty-navigation warning and explicit discard. | patch |
| Blind4: delayed detail response | high: mounted alone does not distinguish visit identity after navigating back/opening another. Invalidate loads and key panel by visit. | patch |
| Blind5: all409 shown as stale | medium: TRANSITION_BLOCKED is a real reachable domain rejection; its reason was hidden. Branch on error code. | patch |
| Blind6: active-visit conflict hides queue | medium: mutation error also controls queue rendering. Separate request errors so an existing visit remains reachable. | patch |
| Blind7: generic audit subject | medium: multiple prescriptions cannot be linked to their fulfilment author from generic prose. Add internal structured subject/transition metadata without clinical text duplication. | patch |
| Blind8: SQL NULL check semantics | medium: direct malformed inserts pass a NULL CHECK result. New additive003 requires true identity and nonnull visit revision. | patch |
| Blind9: restore schema unverified | medium: row digest alone would pass if constraints/triggers were omitted. Compare columns, constraints, indexes, trigger/function definitions, sequences and views. | patch |
| Blind10: keyboard reachability | medium verification gap: programmatic focus bypasses Tab order. Add actual Tab/Shift+Tab coverage. | patch |
| Edge1: delayed detail response | high: same demonstrated wrong-patient response race as Blind4. | patch, grouped Blind4 |
| Edge2: 409 error suppression | medium: same reachable rejection suppression as Blind5. | patch, grouped Blind5 |
| Verification1: progress/count assertions | medium regression gap: clinical state tests would pass with summary counts always zero. Assert intermediate handoff/cancellation summaries. | patch |
| Verification2: visit pagination browser gap | medium regression gap: API tests do not protect browser Next/Previous or filter reset. Add multi-page browser case. | patch |
| Verification3: restore constraints gap | medium broken-verification gap: omitted post-data schema would still pass data-only inventory. Same cause as Blind9. | patch, grouped Blind9 |


## Verification
Existing checks plus PostgreSQL role/projection/isolation/concurrency/rollback/stale/retry tests; desktop/mobile full connected workflow and API secrecy assertions; screenshots and bounded independent reviews. Restore smoke in disposable DB. Push only after checks, inspect GitHub Actions and resolve failures. Record measured results and remaining live-use gaps.


### Measured checks (2026-10-13, local)

- Frontend/server TypeScript checks and production bundle pass.
- 14 domain/storage unit tests pass; combined PostgreSQL suite29/29 pass in43.4s.
- Original walkthrough desktop/mobile browser suite12/12 pass in1m. Initial GitHub
  run caught a test synchronization race before Escape; assertions now await the
  saved fulfillment/settlement before checking focus after a removed trigger.
- Local Semgrep49 rules/79 targets:0 findings; Trivy configured HIGH/CRITICAL gate passes.
- Local custom-format backup restored into a disposable database: all10 public
  table counts and content digests match. Source unchanged; temporary database removed.
- Synthetic demo role accounts provisioned with private ignored password files.
- Full outpatient browser and independent review results to be appended below.

Mutation locking currently serializes writes within one hospital to keep retry
receipts and transitions deterministic. Throughput is unmeasured. Role policy and
prices remain demonstration assumptions. This slice does not establish clinical,
regulatory, security-assessment, capacity or production deployment readiness.

- Outpatient browser suite8/8 desktop/mobile passes (1.5m): full journey, role handoffs/projections, lost responses, stale drafts, session clearing; tested axe checks0 violations. Fixed cancelled queue-load state that had disabled checked-in visit forms.
- npm audit:0 advisories across locked packages.


### Review patch verification

- Backend12/12 scoped tests and final combined30/30 PostgreSQL tests pass (45.7s).
  Migration003 preserves002 data and adds strict nonnull identity/revision checks
  plus exact audit subject/transition attribution. Summary/count transitions tested.
- Restore rechecked after003: all10 public table counts/content digests and schema
  metadata match, including constraints, indexes, trigger and function definitions.
- Final typechecks, unit14/14 and production build pass. Semgrep49 rules/80 targets
  reports0 findings; configured Trivy gate passes; npm audit reports0 advisories.
- Existing mobile directory pagination regression reproduced: absolute hidden
  Check-in labels escaped their unpositioned table container, enlarged document
  width and broke pointer coordinates. Relative table containment fixes it;
  targeted browser case now passes6s. Regression asserts scrollWidth against
  clientWidth (innerWidth also expanded and could falsely pass overflow checks).
- Repeated local test runs exhausted the development loopback login-attempt bucket.
  Only that local synthetic-test counter was reset; production limiter code and
  integration rate-limit tests were unchanged. CI uses its fresh database.

- UI review patches:14 targeted desktop/mobile tests pass plus strengthened
  delayed-response assertion. Exact-request retry, role projection and existing
  visual composition preserved. Added ordinary refresh, explicit draft discard,
  displaced-result recovery, scoped detail responses and real Tab/Shift+Tab checks.
- Full browser suites exceed50 synthetic logins per15min across a single loopback
  IP. A test-only fixture now resets only that development IP bucket per sequential
  file/project; it requires MEDI_BROWSER_TEST=1 and the dedicated local database,
  rejects production, and leaves account limits/application limiter code intact.
  This makes a clean combined run reproducible without weakening runtime controls.


### Final local acceptance

All15 individual review findings were classified and resolved (duplicate root
causes grouped); no unresolved finding was deferred from this slice. Independent
Impeccable patch scoring again returned `disposition: ship` for the four refreshed
captures. Its visual verdict covers captured billing/history layouts, while
behavioral tests cover draft recovery and table containment.

Combined staff/outpatient browser suite30/30 passes in3.1m, covering both desktop
and mobile; original walkthrough12/12 passes. Final server30/30, unit14/14,
frontend/server typechecks, production build, security gates and isolated schema+
data restoration pass. Secrets, local accounts, backups and test artifacts remain
excluded from the public repository. GitHub checks run on the published commit;
its exact run/result is verified and linked in the delivery message.

Production hosting, live hospital/clinical validation, real tariffs/medication
inventory, MFA/recovery, complete ASVS assessment, operating telemetry and tested
production disaster recovery remain outside this completed synthetic outpatient
MVP. Hospital mutation throughput has not been measured. See docs/readiness.md.


### GitHub follow-up

The first feature-commit run passed security, build, unit, original-browser and
server checks;29/30 staff browser cases passed. The mobile handoff assertion
matched both the textarea and newly persisted prescription during the effect
that clears the draft. Added explicit empty-draft waits before matching saved
note/prescription text in both affected journeys. This checks completed UI save
state and removes selector ambiguity without retries or changed application logic.

Affected desktop/mobile journeys4/4 pass after the explicit save-completion waits.
