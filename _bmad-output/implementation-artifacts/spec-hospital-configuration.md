---
title: Hospital service configuration
type: feature
created: 2026-10-13
status: done
route: dispatch
review_loop_iteration: 1
baseline_commit: fa4c6e33493e75c88efd77dd45a886655768382f
context: [AGENTS.md, PRODUCT.md, DESIGN.md]
---

<frozen-after-approval reason="User authorized completing hospital administration and configurable services">

## Intent

Each hospital administrator can maintain its own departments and service catalog
without a product fork. Add a usable configuration workspace with versioned ETB
prices, stable service codes, active/inactive states and attributable history.
This provides the source catalog for the financial workflow; existing synthetic
outpatient tariffs must remain explicitly separate until finance integration.

## Boundaries & Constraints

Always enforce hospital membership and admin-only writes on the server, including
current authority after the hospital transaction lock. Authenticated staff may
read the active catalog; only admins may read inactive entries/history. Use
strict schemas, integer minor-unit money, revisions, atomic audit/idempotency,
safe error messages and stable identifiers. Retain previous service versions and
authorship. Deactivate rather than delete referenced departments or services.

Never invent tax rates, billing policy, clinical rules, localization requirements,
or claim that this catalog already changes old demonstration charges. Do not allow
changing hospital code, arbitrary currencies or customer-written code. This is
synthetic local implementation of reusable configuration, not approved pricing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Department | Admin creates/renames/deactivates department | Saved within this hospital, stable ID/code and updated revision | Duplicate code or stale revision conflicts |
| Service | Admin creates service with department, code, name and ETB price | Active catalog entry with immutable version and effective timestamp | Invalid amount or foreign/inactive department rejected |
| Price change | Admin edits service price/name or availability | New version; earlier version remains unchanged and readable by admin | Stale edit cannot overwrite colleague |
| Retire | Department or service inactive | Hidden from ordinary active catalog, available in admin history | No deletion of historical references |
| Boundaries | Non-admin write or other hospital ID | Denied without data leak | 403/404; CSRF/Origin enforced |
| Retry | Repeated key/identical payload after lost response | One version/audit entry and original response | Different payload conflicts |
| Concurrency | Access revoked or two edits race | At most one revision advances; revoked actor cannot commit later | Explicit refresh/retry with preserved draft |
| UI | Empty list, validation/load error, dirty/uncertain save | Clear forms; guarded navigation; no lost draft or regenerated retry key | Keyboard/mobile accessible with retry |

</frozen-after-approval>

## Code Map

Existing `server/auth.ts` exports `currentActor(client,session)`; use after hospital
row lock and require active admin without password-change restriction. Existing
`app.ts` owns session, Origin and CSRF hooks; route registration receives its
`WeakMap<FastifyRequest,Session>`. `server/db.ts` uses additive numbered migrations.
`StaffApp.tsx` integrates workspace navigation and clears all data on session loss.
`api.ts` provides typed request/error behavior. Preserve staff-administration work.

## Tasks & Acceptance

- [x] `shared/configuration.ts` — strict commands, public DTOs, exact decimal↔minor
  money parsing/formatting with a bounded amount and no float rounding.
- [x] `server/migrations/005_hospital_configuration.sql` — hospital-scoped tables,
  constraints, composite FKs, department/service revisions, immutable service
  versions, audit and idempotency receipts.
- [x] `server/configuration.ts` — paginated/searchable admin lists and active
  catalog, create/update commands and history with proper projections/validation.
- [x] `src/staff/HospitalConfiguration.tsx`, `configuration.css` — departments and
  services UI with history, decimal price entry, mutation/draft handling and focus.
- [x] `server/configuration.test.ts`, `tests/configuration.spec.ts` — all matrix
  cases, real PostgreSQL races/replays/rollback/isolation and desktop/mobile a11y.
- [x] Parent integrates route registrar, migration 005, StaffApp navigation,
  package/Playwright test registration and release runtime privileges once files
  are ready. Builder sends exact integration contract and table privileges early.

Given two hospitals, when either configures a service, then the other cannot read
or alter it. Given a historical version, when price changes, then its original
amount/name/department snapshot remains intact. Given a disabled department,
when ordinary staff load the active catalog, then none of its services are offered.
Given ETB decimal values, when parsed/displayed/saved, then amounts round-trip
exactly including zero and two fractional digits, rejecting negative/overflow.

## Implementation Notes

This independent slice is authorized under the full roadmap instruction. Builder
owns only the new configuration files above. Parent owns integration in shared
existing files, avoiding conflicts with the concurrent staff feature. Do not
modify other agents' files or run broad unrelated tests. Follow Impeccable with
the established calm light/teal design and a bounded screenshot/finish review.

## Spec Change Log

- Review iteration 1, B2.5: re-derived active department retrieval and the picker
  from the contract below. Active filtering occurs before pagination; browsing
  pages retains the selected department. This prevents inactive first-page rows
  from hiding valid choices. KEEP stable codes, integer ETB conversion, immutable
  versions/history, authorization, retry/draft guards and prior passing tests.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
| --- | --- | --- | --- |
| C.B1 | medium | Current service projection takes department name from historical version even after a department rename; current catalog should show current organization while historical snapshots remain intact. | patch |
| C.B2 | medium | Empty result branch suppresses Previous after the last matching page-two row is renamed, hiding remaining page-one matches. | patch |
| C.B3 | medium | Reload advances revision while retaining even untouched old fields, so a price-only draft can overwrite an unrelated concurrent rename. Preserve edited fields and refresh untouched values; display current baseline for overlapping edits. | patch |
| C.B4 | low | Every keystroke starts count/list work under shared hospital lock; search delay and abort of superseded browser requests are direct corrections using existing request options. | patch |
| C.B5 | medium | A queued configuration transaction can outlive the browser timeout and retain a pool connection; bound its lock and statement waits and roll back with retryable response. | patch |
| C.B6 | low | Explicit search indexes duplicate existing unique-index keys; remove through an additive migration because migration005 is already applied. | patch |
| C.B7 | low | Direct privileged SQL can change codes, but all exposed writers preserve them and no existing caller mutates them. Additional triggers guard hypothetical future writers rather than everyday reachable operations. | reject: rare low-impact case requiring new guards |
| C.B8 | low | Direct SQL can mismatch event prefix/entity; the only runtime event writer derives both from the same validated command. Extra DB branching guards a hypothetical future writer, with no reachable application mismatch. | reject: rare low-impact case requiring new guards |
| C.B9 | medium | Changing an existing service's department is implemented but its preserved-history/foreign-inactive rejection path lacks a regression. | patch |
| C.E1 | medium | Same verified empty-page recovery defect as C.B2, independently reported. | patch |
| C.V1 | medium | Preverified regression gap: browser catalog rows do not assert exact decimal ETB for administrator and clinician views. | patch |
| C.V2 | medium | Preverified regression gap: browser Older/Newer history controls are not exercised beyond25 revisions. | patch |

## Verification

Frontend/server typechecks, configuration integration/browser tests, money edge
tests; parent full integrated suite, source/dependency scans, restore verification
and independent diff review before recording completion.

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

### Review-derived department selection contract

Re-derive department picker retrieval so administrator editing uses active-only
filtering before pagination, with next/previous result pages and retained selected
department when browsing. Extend the strict list query with optional active=true;
ordinary nonadmin reads remain active-only regardless. Existing department/service
catalog defaults are preserved. KEEP stable codes, exact ETB conversion, current
version snapshots, immutable history, role/tenant isolation, lock authorization,
retry/draft behavior and all prior passing tests. The known-bad first25 inactive
results must not hide active choices. This implements existing general catalog
intent; no user product choice changes. Add read lock/revocation cases for list,
detail and history to cover the separate read branch.

### Latest verification checkpoint

Full API regression passed61/61 (253.1s). Configuration API13/13 and browser8/8
passed, plus final2/2 picker captures. Independent bounded picker visual review
disposition: **ship**. Documentation check found no system update necessary;
incumbent design files were preserved. The review rows above add targeted fixes
and regression assertions; final evidence will be updated after those patches.

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
