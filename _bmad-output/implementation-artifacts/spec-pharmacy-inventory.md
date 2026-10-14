---
title: 'Pharmacy stock and quantity dispensing'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'dispatch'
baseline_commit: 'b902619f5e400ee5df41bfb6048fddae0f97e476'
review_loop_iteration: 1
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/PRODUCT.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/DESIGN.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/.agents/skills/impeccable/reference/craft-floor.md'
---

<frozen-after-approval reason="User authorized remaining engineering work, split into sequential slices.">

## Intent

**Problem:** Free-text prescription completion does not track physical stock or partial supply.
**Approach:** Hospital product/batch inventory, immutable movements, and clinician-authorized quantities linked to existing prescriptions. Pharmacy records actual partial/full supply; originals and stock movements remain attributable.

## Boundaries & Constraints

**Always:** Hospital isolation, current authority after locks, normalized UUID exact retries, bounded transactions and concurrent-stock integrity. Clinician/admin explicitly authorize product and positive integer base-unit quantity; pharmacy never infers quantities from instructions. Admin/pharmacist maintain inventory; clinician reads active product choices; auditor reads inventory history. Existing light/teal UI.
**Never:** Infer dosing/substitution/pack conversion, allow negative stock, overwrite ledger or prescribe automatically. Procurement, controlled items, returns/restocking, multiple stores, valuation and production formulary validation remain separate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Product/batch | Hospital-unique code, descriptive name, immutable base unit; lot/expiry | Versioned active/quarantine status, attributable immutable identity/history | Duplicate/foreign/invalid rejected |
| Stock | Receipt reference or signed adjustment reason | Append movement; derive balance; no negative result | Overflow/zero/missing provenance rejected |
| Allocate | Clinician/admin, active pending prescription, product/quantity | Preserve instruction, explicit immutable authorization | Pharmacist cannot authorize; no duplicate replacement |
| Dispense | Matching active product and available batch, quantity <= remaining | Partial leaves pending; full completes atomically with stock+visit audit | Excess/stale/closed/cancelled denied |
| Expiry/quarantine | Expiry on or before current Addis date, or quarantined | Ordinary supply blocked; visible excluded stock | Server decides eligibility, no browser clock trust |
| Cancel remainder | Linked partially supplied prescription, reason | Preserve supplied quantities and ledger; cancel only remaining | No implied stock return |
| Race/retry | Concurrent last-unit supply or same-key replay | One valid supply; stable receipt; no oversell | Conflict, altered actor/payload rejected |
| Access/failure | Foreign resources/role change/DB audit failure | Scoped denial or rollback, no half supply | 404/403/401/503 |

</frozen-after-approval>

## Code Map

- `server/outpatient.ts`, `shared/outpatient.ts`, `src/domain.ts`: original prescriptions are free text/pending; block legacy fulfill bypass for linked prescriptions. Full dispense/cancel must use existing domain transition and visit revision/audit in same transaction, retaining clinical correction close gates.
- `server/billing.ts`, `server/clinical.ts`: hospital-first locking, currentActor, immutable history/retry patterns; additive inventory tables with tenant FKs and runtime grants.
- `src/staff/StaffApp.tsx`, `VisitPanel.tsx`, `VisitWorkspace.tsx`: guarded surfaces and visit pharmacy section. Distinguish unlinked legacy handoff from stock-accounted supply.
- `server/db.ts`, `server/app.ts`, `deploy/migrate.mjs`, package/test configs: explicit integration.
- `tooling/database.mjs` all-table restore; root owns release-verifier extension.

## Tasks & Acceptance

**Execution:**
- [x] Shared schemas/DTOs, additive migration and backend -- products, immutable batch identity, revisioned active/quarantine flags, stock movements, prescription authorizations, dispense/cancellation events and retry receipts. History snapshots and strict bounded paging. Every new table has explicit grants and immutable history guards.
- [x] Outpatient integration -- project allocation/remaining amount; serialize inventory and visit commands with hospital lock; no legacy bypass; preserve pending blocker on partial supply; stale visit revision rejects command.
- [x] Staff UI -- inventory catalog/batches/history, receipt and reasoned adjustment, quarantine/active controls; pharmacy authorization/partial dispense/remainder cancellation inline. Current stock, base unit, lot/expiry and remaining prescription quantity visible before confirmation; exact uncertain retry and preserved drafts/guarded navigation/session reset.
- [x] API tests -- every matrix row, two-hospital/role boundaries, uppercase retries, post-lock revocation, race on last stock and last prescribed quantity, rollback injection, immutable DB history, expiry today/yesterday/tomorrow.
- [x] Browser tests -- desktop/mobile catalog-to-partial/full supply plus loss/retry, error/loading/empty, navigation drafts, keyboard/axe and captures.
- [x] Docs -- describe shipped capabilities, provisional conservative expiry boundary and clinical/pharmacy validation still required.

**Acceptance Criteria:**
- Every stock-accounted dispense links one immutable stock movement and authorized prescription; remaining and batch balances reconcile exactly.
- No stock deduction can commit without matching dispense/visit/audit/idempotency records.
- A new hospital starts empty, can configure its own catalog, and cannot see another hospital's inventory.

## Implementation Notes

Update the additive-upgrade migration expectation in `server/outpatient.test.ts` when adding the next migration; preserve historical-row assertions.

Root owns `tooling/release-verify.mjs` and final release/restore/security checks. Implement full slice including integrations/tests/docs; no commit/push. Preserve established visual world; Impeccable context unavailable earlier, direct PRODUCT/DESIGN fallback applies. Root provides finish/documenter handoffs. Sequential implementation follows clinical slice; inspect its actual contracts before editing. Product code, descriptive identity and base unit remain immutable after creation; active state can change with revision/history. Clearly label unlinked legacy handoffs as not accounted in stock, and distinguish expiry-day blocking from an already expired batch in UI. Use the project-local Impeccable engine via `IMPECCABLE_HOME=$PWD/.cache/impeccable` for the single final detector pass; context already loaded this session.

## Spec Change Log

- Review pass1 refines subject/actor attribution, refresh/focus truthfulness, one-clock expiry projection and complete boundary/paging verification. Preserve passing stock/remainder/ledger, role/session, exact retry, additive migration and desktop/mobile flows. Re-derive affected paths incrementally without deleting verified unrelated work; intent remains authorized stock-accounted supply.

### Review implementation requirements

- The dispense CHECK must explicitly require non-null movement_id for kind dispense; preserve existing event/movement/visit integrity. Because009 has run locally, use additive010 hardening migration rather than silently changing applied009. Register it in both runners/runtime grants as appropriate and update historical migration expectations. New installs apply both009 and010. Reports migration becomes011.
- Show prescription number and original instruction in every pharmacy editor. History must identify prescription context (number/instruction for an authorized visit view, stable visit/prescription identity for global inventory history) and recorded lot expiry. Return stable actorId alongside captured actorName in authorization and event DTOs; render an accessible identity disclosure and test duplicate names.
- Refreshing choices must invalidate a selected batch when revision, balance or eligibility changes, clear confirmation and require explicit adoption of current eligible state. Do not mistake paging the chosen batch offscreen for an authoritative deletion; retain drafts and exact uncertain retries. Mirror honest stale-stock handling for the inventory editor where relevant.
- Focus inventory headings after product navigation and meaningful saved content after editors disappear; include keyboard assertions. Saved notices confirm commitment only; never claim quantities/history refreshed before successful reads. Failed refresh must not imply current values.
- Capture one Addis date after authority/lock acquisition for a batch read and reuse for every row eligibility and response.today; avoid per-row/time-separated midnight inconsistencies. Exercise boundary using controlled clock/query evidence without wall-clock sleeps.
- Add populated two-hospital, multiple-product/visit successful-list/history isolation tests. Add blocked fresh-write/read tests for inactive/role/password-reset/expiry alongside existing revoked replay, with no new state/protected data.
- Verify26+ products/batches across API pages; browser product search resets page, next/back products/history work, and pharmacy can select and supply a later-page batch. Verify status conflict retains desired active/quarantine action and reason when another operator already applied that status. Test refresh failure, stale selected stock, multi-prescription target/history and duplicate attribution.

## Review Triage Log

| Finding | Verdict and evidence | Resolution |
| --- | --- | --- |
| Blind1 nullable movement CHECK | low: API always supplies movement_id, but direct insert can satisfy CHECK with NULL; simple constraint correction warranted | Explicit non-null check via additive010 and targeted integrity insertion test |
| Blind2 ambiguous editor subject | high: editor after all prescriptions shows generic title/product but no target number/instruction | Identify prescription in editor |
| Blind3 ambiguous history subject | medium: prescriptionId exists in DTO but renderer ignores it, same-product supplies indistinguishable | Render prescription context |
| Blind4 missing historical expiry | medium: immutable snapshot contains expiry, renderer omits recorded value | Render expiry with lot |
| Blind5 duplicate actor names | medium: database retains actor_id but DTO/UI only show nonunique snapshot names | Expose stable actor identity without replacing snapshots |
| Blind6 stale selected batch | medium: refreshed choices do not update/invalidate draft.batch or confirmation; current list can conflict with selection | Explicit version/eligibility adoption after refresh |
| Blind7 lost keyboard focus | medium: selected button/editor disappears without destination; heading is not focusable | Focus stable meaningful headings/content and verify |
| Blind8 premature refreshed claim | medium: onSuccess announces refresh before asynchronous reads and may coexist with refresh failure | Confirm saved only; current state only after successful read |
| Blind9 authority evidence | medium: test title was corrected, but only revoked saved-key path is exercised | Add fresh-write/read lock tests for four authority changes |
| Blind10 pagination evidence | medium: only event paging tested; products/batches and browser navigation unproven | API and later-page browser coverage |
| Edge1 midnight projection | low: volatile row clock and separate response clock can disagree across midnight | Single post-lock Addis date per batch read |
| Verification1 successful read isolation | high: unpopulated foreign hospital cannot detect successful catalog/history leakage; visit filter removal passes | Populated two-hospital/product/visit exact response tests |
| Verification2 product/batch paging | medium: same separate untested offset paths as Blind10 | Same broader paging evidence |
| Verification3 status-intent recovery | medium: current code preserves intent but no regression catches flipping desired state on refresh | Same-status concurrent conflict test retains action/reason |

Three layers all returned before triage. New threads unavailable: reused two non-implementer reviewers plus implementation thread for verification-gap; independence limitation recorded.

## Verification

Planned required checks (results must be recorded after execution):

- `npm run typecheck`, `npm run typecheck:server`, `npm run build`.
- `npm run test:server` includes inventory and existing regression.
- `npm run test:staff -- tests/inventory.spec.ts` for desktop/mobile with captures.

- Root: isolated HTTPS release build/verification passes inventory receipt/partial/full supply, exact replay, legacy guard, restricted grants and29 persisted record groups. Local restoration34tables matches schema/counts/digests. Trivy configured scan passes0findings. Broader API regression in progress. Clinical baseline CI38530584591 completed successfully.

Implementation verification — 2026-10-14:

- Frontend/server typechecks and production build passed. Frontend typecheck passed again after final draft-loading/status-intent fixes.
- Focused API `node --import tsx --test --test-concurrency=1 server/inventory.test.ts`:13/13 passed. Covers immutable ledger, tenant/role/CSRF, expiry boundaries, concurrent stock/remainder, rollback and exact replay, including replay after post-lock revocation.
- Initial browser `npm run test:staff -- tests/inventory.spec.ts`:12/12 passed desktop/mobile, including keyboard submission and axe. Screenshot capture confirmation is recorded below when complete.
- Single Impeccable detector:0 anti-patterns; one13px helper-size advisory matching the existing staff implementation. DESIGN.md and sidecar preserved. Output: `/tmp/medi-inventory-detector.txt`.
- Root's isolated HTTPS release verifier passed inventory receipt10, authorization4, supplies1+3, final stock6, exact replay and legacy bypass denial with restricted runtime permissions. Root owns broader regression, final review and restore evidence.
- Shipping raster assets: none. Screenshots are synthetic development evidence. Professional pharmacy policy, expiry interpretation, formulary governance and excluded workflows remain unresolved as documented.

- Root final pre-review full API115/115; Semgrep140targets0findings (new backend/shared/UI confirmed scanned); inventory browser12/12 plus2/2scrolled-action captures; all10clean captures inspected. No production validation claimed.

Review correction verification — 2026-10-14:

- Implemented all accepted correction requirements: additive010 non-null movement constraint; original prescription context and recorded expiry; stable actor disclosures; retained selected-batch projection and explicit stale-state adoption; heading/saved-notice focus; truthful commit-only notices; single post-lock Addis date.
- `npm run typecheck`, `npm run typecheck:server`, `npm run build`: passed.
- `node --env-file-if-exists=.env --import tsx --test server/inventory.test.ts`:18/18 passed, including populated010 upgrade, tenant/subject successful reads,26-record pages, controlled midnight projection, actor IDs and fresh write/read post-lock authority checks. Final stock-history expiry assertion also passed in its focused API rerun.
- Browser correction coverage:9desktop cases passed; the pagination fixture was interrupted after its filler names unintentionally matched the target search. Corrected only those fictional names, then paging passed2/2desktop/mobile and remaining mobile cases passed9/9. All20inventory cases therefore passed across these bounded runs. No implementation defect was hidden by the fixture correction.
- Updated screenshots: `artifacts/inventory-ui/{desktop,mobile}-{stock,stock-actions,partial,fulfilled,draft,subject-editor,subject-history,stale-stock,status-conflict}.png`. Inspected both viewports for the eight newly added subject/history/stale/status captures; no skip-link capture artifact or page overflow. Browser assertions check keyboard focus, axe, preservation of status intent/reasons, failed refresh truthfulness and later-page supply.
- No second detector pass; the earlier single-pass result remains recorded. No new world/system decision, shipping raster, DESIGN.md or sidecar modification. Root owns independent fix review and final release/security/restore verification.

Final correction verification:

- Both non-implementer follow-up code reviews confirmed every accepted finding resolved, with no introduced material regressions; no accepted finding deferred.
- Final Semgrep:141 scanned targets,0 findings,0 errors. Dependency scan remains clean with unchanged dependencies.
- Final packaged HTTPS release build and verifier passed after the last history-expiry change: stock receipt, partial/full dispensing, exact replay, bypass denial, immutable runtime grants,29 persistent record groups, and built browser authentication.

- Final visual review opened18 captures and requested recapture of the two status-conflict states, which initially showed settled content after discard. Capture timing/assertions were corrected without application changes; affected desktop/mobile tests passed2/2 and both active-conflict screenshots were replaced.

- Final Impeccable disposition: **ship** after reviewing both replacement captures; all18 covered, no material fixes. Documenter: no design-system changes. No accepted review item remains deferred.

- GitHub Actions38535354893 completed successfully for04a1ace3bc39b9f712b20a01a2c91bd81c2773bc: tooling/application regression, source/dependency security and local HTTPS release/restart jobs all passed.
