---
title: Complete Medi hospital product and standardize its repository
status: in-progress
baseline_commit: deaad870638655e5b8a313ce3319e27e072777f9
created: 2026-10-14
---

# Authorized delivery

The founder explicitly requests the complete production-ready hospital web app,
including unused/duplicate file cleanup, and authorizes necessary engineering.
Do not stop at an outpatient slice or a planning handoff. Preserve existing
accounts, records, original encrypted archives/keys and immutable historical SQL.
Never represent fabricated hospital/clinical/legal approval as evidence.
Minimize repetitive model output, broad test runs and review cycles.

## Product acceptance

- One authenticated browser application at `/`, with `/staff` retained as an alias.
  Remove the abandoned localStorage prototype and its obsolete tests/docs.
- Complete hospital workflows: longitudinal patient identity, audited demographic
  corrections and duplicate resolution; scheduling/check-in/cancellation;
  triage/vitals; admission/bed transfer/discharge; nursing and accountable
  medication administration; referral/follow-up; configurable lab catalog,
  specimens/rejection/recollection/critical escalation; pharmacy procurement and
  return/quarantine; financial adjustments/refunds and cashier reconciliation.
- Configuration includes facilities, departments and operational settings.
  A hospital configures values and qualified staff enter clinical facts. Never
  invent clinical decision thresholds or automatically recommend treatment.
- Hospital/role authorization, renewed post-lock authority, CSRF/Origin,
  transactions, stale-revision protection, durable idempotent commands and
  append-only attributable histories cover every added operation.
- Audited, bounded authorized patient/organization exports and record requests;
  held records remain retained. No automatic unapproved patient destruction.
- Database tenant isolation is enforced for clinical/financial/stock data in
  addition to application queries; authenticated identity bootstrapping remains
  narrowly scoped. Include restricted-role foreign-tenant read/write evidence.
- Existing MFA, backups, privacy, telemetry, upgrade/rollback and capacity
  protections remain. Add an actual portable production installation with a
  configured HTTPS domain, private services, independently supplied secrets,
  backup scheduling/offsite target and human alert destination configuration.
- Publish one accurate README, architecture/runbook and capability/status source.
  Archive useful historical research/evidence; delete unused application code,
  duplicate commands and obsolete documents. Preserve user-created `.vscode`.
- Verify types/build, module integrity/race/negative cases, representative
  desktop/mobile browser workflows, accessibility, source/dependency/security
  checks, actual packaged install/restart, genuine upgrade and recovery, and CI.

## Ownership for bounded implementation

Root owns integration, repository cleanup, the existing app.ts/StaffApp.tsx
entry points, schema-manifest.ts/runtime-grants.ts and shared role lists,
production installation/privacy/export/tenant policies, final review and delivery.
The care builder implements its own server/shared/UI modules and migration016.
The departments builder implements its modules and migration017; it may extend
billing/inventory summaries but never changes historical SQL or receipts.
Both builders deliver an exported Fastify route registration function and React
workspace component; send root explicit integration/grant instructions. Do not
edit each other's files or root-owned files; no nested agents/commits/pushes.
Migrations stay consecutive; root records hashes/grants after both return.
Clinical/department workspaces must preserve draft/uncertain request state when
switching tabs and clear all sensitive state on logout/identity change.

## Verification and release gates

Focused tests must assert the real workflow and rollback boundaries, foreign
tenant/forbidden role, revoked actor after lock wait, duplicate and altered-key
replay, stale revision and concurrency; run once then rerun only affected failures.
Root performs one combined independent review and final integration/CI run.
Operational acceptance is engineering-verifiable. Recruiting actual hospital
acceptance authorities, signing legal/customer terms and choosing paid hosting
remain founder responsibilities, with concrete deployable artifacts supplied.

## Tasks

- [x] Remove obsolete prototype and consolidate app/scripts/documentation.
- [x] Implement complete patient/care lifecycle.
- [x] Implement complete departmental operational controls.
- [x] Implement configuration, privacy/export and database tenant policies.
- [x] Ship portable production installation and operational handoff.
- [ ] Complete integrated verification/review, delivery CI and accurate handoff.

## Resume checkpoint — user explicitly stopped work, 2026-10-14

Stop immediately; do not continue until the founder resumes. No builders remain running.
All current changes are preserved locally and uncommitted. Prior delivered HEAD:
`deaad870638655e5b8a313ce3319e27e072777f9`; prior successful CI38584302746.
User-created untracked `.vscode/` belongs to founder; preserve it.

Completed since baseline:
- Removed abandoned prototype screens/storage/seed/Dialog/VisitDetail, prototype
  browser tests/config and three obsolete prototype documents. Kept server-used
  domain rules by relocating to shared/visit-domain.ts with its two unit suites;
  existing imports updated. `/` now loads StaffApp; `/staff` remains valid.
- Package renamed medi, unused Radix removed, exact Prettier3.9.10 installed.
  Formatter config/scripts/formatting and README consolidation still pending.
- Nurse role added in shared role/admin/outpatient/report maps and setup; migration016
  extends staff/history role constraints. Historical SQL remains untouched.
- Care builder complete: care API/schemas/workspace/migration016, profile corrections,
  identity links, appointments/arrival, triage, beds/admissions/transfers/discharge,
  nursing, medication outcomes and referrals. Focused9/9 plus timezone1/1 and
  merged-identity regression1/1 pass. Addis UTC+03/Gregorian explicit care times;
  unchanged ISO precision preserved. Browser care.spec.ts awaits integrated run.
- Department builder complete: lab catalog/specimens/critical/corrected review,
  purchasing/partial receipts/returns/quarantine, financial credits/refunds/shifts.
  Departments11/11 + affected billing/reports41/41 pass; both types passed at handoff.
  Existing invoice/inventory/report projections extended. departments.spec.ts awaits
  integrated browser run. Builders remain available for bounded fixes.
- Root integrated three route registrars and care/department/hospital workspaces;
  department navigation role-filtered. Added legacy encounter collection/release
  bypass guard for managed specimens, pending lab-review closure guard, and merged
  duplicate check-in guard (department/care regressions pass).
- Schema manifest pins frozen016/017 and root018_hospital_governance.sql. Explicit
  grants added for all new tables.018 adds profiles/facilities/record requests/holds/
  support grants/governance history+receipts and hospital_id RLS policies excluding
  narrowly scoped identity bootstrap tables. currentActor sets tenant GUC locally;
  readSession/currentActor enforce support expiry/revocation.
- Root hospital governance API/UI implemented (not yet tested): facility/profile
  changes, approved record export, holds, named auditor support windows, bounded
  organization export and histories. Pending: hospital.test.ts, actual restricted-role
  RLS tests, complete export allowlist/composite-key ordering and patient export
  historical/amendment coverage. Locale/calendar settings must actually affect
  display before claiming functionality; date formatting integration still pending.
- Secret-file DB configuration implemented server/secrets.ts; createPool reads
  DATABASE_URL_FILE; deploy/migrate supports MEDI_RUNTIME_PASSWORD_FILE.
  deploy/secrets-init.mjs provisions separate API/owner/database secret volumes.
  Dockerfile copies initializer. Not yet runtime-verified.
- Draft compose.production.yaml and deploy/Caddyfile.production added: HTTPS domain,
  strict CSP/isolation headers/HSTS, private DB/API/monitoring, independent secret
  volumes. Monitoring service blocks copied from verified release Compose with
  real pinned digests (including collector-storage) and repaired logs/volume names.
  Draft needs compose/Caddy validation and actual isolated local install rehearsal.

Critical remaining next actions:
1. Finish root governance tests/exports/date settings and production prepare/operator
   CLI, authentic production backup/restore + scheduled independent/offsite target
   and configurable human alert destination. Existing release backup harness uses
   synthetic fixtures; don't pass it off as an actual customer backup installer.
2. Consolidate canonical README/architecture/runbook/capability status; fix links to
   deleted prototype docs and remove obsolete setup claims. Finish formatting
   standard/CI. Do not delete original archives/keys/images or local agent tools.
3. Add server/care-time.test.ts and hospital.test.ts to scripts. care/departments
   test files already included; staff browser config includes care/departments.
   Root fixed named CareWorkspace import and outpatient nurse-map errors; rerun
   type/build after final integration, no redundant broad cycles.
4. One combined independent security/integrity review after frozen implementation;
   verify changes semantically before bulk formatter noise. Fix real failures.
5. Run integrated API/browser/a11y/security and packaged install/restart/tenant
   isolation/genuine upgrade/recovery/capacity/CI checks, preserve failed evidence.
   Legacy fixture expected migration numbers15 must become current manifest count
   where testing current code; genuine original1–11 archive stays unchanged.
6. Restore usable local app at final: migrate development schema18+, restart owned
   API with explicit synthetic policy, preserve founder demo/admin password in
   ignored .local/admin-password.txt. Do not expose credentials or invent live
   hospital/legal approval. Deliver deployable product and honest actual evidence.

No production deployment or external message was performed. No current verification
claim covers the unfinished root installer/governance/integrated application.

## Resumed integration — 2026-10-14

User resumed stopped work. Local development migrations applied through019;
owned stale API was replaced, Vite restored. Existing accounts/private credentials
were preserved. Shared unit11/11 and frontend/server typechecks pass. Installer
unit4/4 pass (local synthetic webhook requires host-network permission).

Bounded final review verified earlier lab lifecycle P1 and governed return-export
P2 fixes. It found stale original-name joins in department source pickers; accepted
for correction to the invoker current-identity view with an affected regression.
Root corrected the old staff-directory count assertion for the added nurse role.
Care representational bounds/pharmacist permissions have affected2/2 checks.
Final combined API/browser/release/CI evidence remains pending.

Removed obsolete prototype sources/tests/docs; preserved shared domain rules,
historical evidence, private archives/keys and founder editor settings. Canonical
README, architecture, development, coverage/readiness and installation guides now
describe the current single app. Prettier configuration excludes immutable SQL.
CI gains formatting and installation tests/drill (including initializer refusals).

Verification update: combined API run224 total,223 passed; the sole failure was
the obsolete eight-account fixture assertion after adding nurse. Updated to the
role-list count and affected case1/1 passed. Operations7/7, preflight tooling1/1,
archive tooling20/20 and release-admission fixture tests3/3 pass. Browser harness
4/4 and MFA browser4/4 pass; controlled MFA artifact refusal also passes.
Semgrep257 files/0 findings, Trivy0 HIGH/CRITICAL vulnerability/secret/configuration
findings, npm audit0 vulnerabilities. Production compilation passes.
Departmental final fixes freeze with3 affected API cases (including corrected-name
picker follow-up) and10 desktop/mobile checks passing. Wider156-case browser run
is ongoing; old outpatient fixtures now explicitly configure/select lab catalog
records, and Care saved-message assertion scopes the correct live region.

Final UI integration:156-case broad desktop/mobile run completed148 pass/8 fail.
Failures were the two old Care saved-status selectors and six old outpatient
lab fixtures lacking explicit configured tests/selection. Updated Care controls
and identity picker now pass4/4 with axe/overflow/inspected captures; measured
Care heading contrast was fixed. Root removed115 unused CSS selectors, renamed
prototype header/prescription/config copy, and standardized source. Affected
supplier/configuration/navigation checks6/6 pass; an outdated catalog fixture
HTTP201 expectation was corrected to the API200 contract.

Root then found and accepted configured-test pre-registration collection/release
bypass. Configured orders now always require specimen operations. Known-label
API compatibility binds a unique current catalog where present, rejects ambiguous
choices, preserves no-match legacy/history fallback and hashes original requests.
Affected API1/1 and both typechecks pass; final bounded review underway. Outpatient
browser fixtures now use accountable specimen commands for configured tests and
a separately named legacy hospital for historical draft compatibility. Final eight
changed outpatient browser checks are running; no SQL019+ change required.

Final affected outpatient browser8/8 PASS; complete departmental API15/15 PASS.
Care4/4 PASS and final static delta review found no verified defect. Anonymous
entry UI desktop/mobile audit passes0 accessibility violations/0 runtime errors;
expected bootstrap-session401 responses are recorded separately. Source formatting
and both typechecks/build pass. Final built Docker services healthy on schema19.
Packaged verification exposed its old unscoped runtime digest helper under new RLS;
fix is limited to the trusted synthetic verifier and compatible historical hashing,
without weakening runtime policy or replacing original fixture/archive material.
Fresh production drill is running independently against final images.


Resume verification, 2026-10-14: packaged verification passes before and after
restart. The original encrypted pre-MFA archive upgrades versions1–11 to19,
preserving33 historical tables; session invalidation, injected migration rollback,
privilege refusal and isolated replacement pass in86s. New encrypted release
format4 restores58 tables/2726 records with exact metadata and content digests,
including RLS policies and invoker view options. Concurrent100-change backup and
source-offline recovery pass; original source configuration/containers retained.
All28 archive/inventory tests and formatting pass. PostgreSQL name[] policy-role
encoding is explicitly converted to text[] in snapshots; original productionformat3
unquoted-role literal encoding remains comparable. Capacity, final production
metadata drill, monitoring readiness retry and exact revision CI remain pending.
The first web scan stalled updating add-ons and was stopped; the pinned scanner
will run with installed rules (-silent), without interpreting stale reports as new.
