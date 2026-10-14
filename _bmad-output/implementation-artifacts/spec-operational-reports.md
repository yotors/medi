---
title: 'Audited hospital operational reports'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'dispatch'
baseline_commit: '04a1ace3bc39b9f712b20a01a2c91bd81c2773bc'
review_loop_iteration: 1
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/PRODUCT.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/DESIGN.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/.agents/skills/impeccable/reference/craft-floor.md'
---

<frozen-after-approval reason="User authorized continuing remaining engineering work.">

## Intent

**Problem:** Hospital staff lack scoped reports for activity, collected payments, outstanding work and stock.
**Approach:** Audited aggregate report with explicit date boundaries, permissions and definitions, separating period activity from current outstanding work. Preserve source transaction traceability without exposing patient narratives.

## Boundaries & Constraints

**Always:** Admin/auditor combined report; clinician operational subset; cashier finance subset; pharmacist inventory subset; receptionist and laboratory roles denied in this aggregate-report slice. Enforce projections server-side. Gregorian dates interpreted in Africa/Addis_Ababa; inclusive selected dates represented as half-open instants, max366 days. Exact decimal-string minor-unit money totals. Consistent hospital snapshot under lock, fresh authority, immutable report read-audit committed before response. Existing staff layout and tokens.
**Never:** Claim revenue, tax reporting, till/bank reconciliation or clinical metrics absent their validated definitions. No patient names, clinical text, payment references, unaudited exports or CSV feature in this slice. No fabricated production readiness.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Period activity | Valid inclusive Gregorian range | Opened/closed counts by respective event timestamp; note/result corrections, receipts by method and exact collected amounts | Invalid/reversed/overlong dates rejected |
| Snapshot | Older unfinished visits/invoices/corrections/prescriptions | Clearly labeled current outstanding counts/balances independent of period; partial prescriptions remain pending | No mixed-period implication |
| Finance | Partial payments, void unpaid invoices, legacy visits | Catalog receipt totals once; current nonvoid outstanding balance; legacy excluded explicitly | No integer overflow/join multiplication |
| Inventory | Products with unlike units, expired/quarantine, period movements | Paged per-product base-unit balances and receipt/dispense/adjustment totals; excluded stock distinguished | No aggregate sum across unlike units |
| Access | Foreign hospital or unauthorized/revoked role | Only current hospital and authorized sections returned | 403/401; no sensitive audit payload |
| Failure/race | Concurrent mutation or read-audit failure | Consistent snapshot and audit, or fail without delivering data | Bounded busy503, no stale UI results |

</frozen-after-approval>

## Code Map

- `server/app.ts`, `server/auth.ts`: session/CSRF/no-store; post-lock currentActor.
- `server/billing.ts`: hospital share lock excludes current hospital mutations; 5s lock/10s statement limits. Invoice totals minus payments, exclude void events; never sum integer-cast per-visit values across hospital.
- `server/outpatient.ts`, `server/clinical.ts`: visit lifecycle and unresolved corrections. Count closures by closedAt rather than opening date.
- `server/inventory.ts` (preceding slice): authoritative stock/dispense ledger; inspect implemented names/contracts before queries.
- `src/staff/StaffApp.tsx`: guarded account surface navigation and session reset; `api.ts` request conventions.
- `server/db.ts`, `deploy/migrate.mjs`: explicit migration/grants; existing patient audit table cannot accept report-read event.

## Report Contract

`GET /api/reports/operational?from=YYYY-MM-DD&to=YYYY-MM-DD&inventoryPage=1`; strict query, fixed25rows, page1–10000. Response includes `auditId`, `generatedAt` (one post-lock UTC ISO instant), `range:{from,to,timezone:'Africa/Addis_Ababa',start,endExclusive}`, and `authorizedSections` plus only their permitted properties:

- `operations:{period:{visitsOpened,visitsClosed,noteAmendments,resultCorrections},current:{activeVisits,pendingInvestigations,pendingPrescriptions,pendingCorrectedResultReviews}}`. Counts numeric safe bounded values.
- `finance:{currency:'ETB',legacyExcluded:true,period:{receiptCount,collectedMinor,byMethod:{cash:{receiptCount,collectedMinor},manual_transfer:{receiptCount,collectedMinor}}},current:{outstandingInvoiceCount,outstandingMinor}}`. Every monetary total is a decimal-string integer in minor units; both method buckets always present.
- `inventory:{today,page,pageSize:25,total,entries:[{productId,code,name,unit,active,current:{total,available,inactive,quarantined,expired,expiryToday},period:{received,supplied,adjustmentNet,movementNet}}]}`. All quantities are decimal-string integers; supplied positive, adjustments/net signed. Per product, category sums equal current total and movementNet=received-supplied+adjustmentNet. Order `(code,id)`, include inactive/no-batch products.

Migration011 `report_access_events`: immutable id,hospital,actor ID/name/role, report kind, date range, generated timestamp, authorized sections, inventory page/page size and returned product-row count. Return inserted `auditId` only after commit. Root verifier can compare period/current deltas, traverse inventory pages to its product and persist exact report audit IDs for restart checks. Each page is a new audited snapshot; do not imply cross-page freeze during concurrent mutations.

## Tasks & Acceptance

**Execution:**
- [x] `shared/reports.ts`, `server/reports.ts`, additive migration011 -- strict query schemas, role-projected report, accurate period/snapshot aggregates, paging for product rows, immutable access events with actor/name/role/range/report kind/time/row count. No clinical payload in audit. Parameterized hospital-scoped SQL.
- [x] Route/migration/runtime grants and test configuration integration.
- [x] `src/staff/OperationalReports.tsx`, staff navigation/styles -- date form, clear range/timezone/generated timestamp, separate activity/current sections, exact ETB formatting, definitions and legacy exclusions. Accessible tables, bounded paging, honest loading/empty/retry, abort stale reads and clear prior range data on failure/session change.
- [x] `server/reports.test.ts` -- every matrix row; leap/year/Addis boundaries; opened outside and closed inside; multi-day partial payments/voids; above32bit totals; correction and partial dispense backlog; role/tenant denial/post-lock session revocation; audit failure/immutability and snapshot consistency.
- [x] `tests/reports.spec.ts` -- desktop/mobile date change, role projection, error/retry/loading/empty, keyboard/axe/captures, navigation/session clearing.
- [x] Docs -- definitions, authorized roles, limits and clinical/financial reporting validation still needed.

**Acceptance Criteria:**
- Known synthetic transactions reconcile exactly to period receipt/movement totals and current balances; no hidden patient identifiers/text in response.
- Each successful report read has attributable immutable audit; unauthorized/failed requests do not produce successful-access entries.
- Reporting does not alter visits, invoices, prescriptions or stock.

## Implementation Notes

Update the additive-upgrade migration expectation in `server/outpatient.test.ts` when adding the next migration; preserve historical-row assertions.

Implementation details confirmed against inventory009/010: capture one clock after the hospital lock/currentActor check for generatedAt, audit time and Addis expiry classification. Stock categories are mutually exclusive in precedence inactive > quarantined > expired > expiry_today > available; include products with zero stock/no batches and use decimal-string aggregate quantities (multiple batches can exceed integer range). Movement dates come from inventory_events joined on hospital_id/id. Display negative dispense movements as positive supplied quantities; adjustments are signed net quantities; cancellation never adds stock. Pending prescriptions come from visit JSON, with partial supply remaining pending. Closed timestamps come from data.closedAt independently of opened_at. Aggregate payments per invoice before outstanding balance, exclude invoice.void, and never multiply payments through line/event joins. Audit page/pageSize, authorized sections and returned product-row count. Avoid executing unauthorized section queries.

Sequential after clinical and pharmacy slices; inspect their actual contracts. Root owns release verifier extension and final release/restore/security checks. Implement integrations/tests/docs, do not commit/push. Established UI extension only. Impeccable direct context fallback; root handles finish/documenter review.

## Spec Change Log

- Review pass1: retain the exact aggregate arithmetic, tenant/role projections, immutable audit schema011, additive upgrade, established visual world and source reconciliation. Refine failed-page retry, cumulative execution deadline and targeted verification gaps; preserve all passing behavior while correcting affected paths.

### Review correction requirements

- Retain the requested inventory page when a report read fails; Retry requests that same page. Editing dates or explicitly starting a fresh report returns to page1. Preserve loading, abort, session and no-stale-result behavior.
- Bound the complete report to a monotonic10-second budget starting before pool acquisition, leaving room before the browser15-second timeout. Enforce remaining budget on active database statements (including lock, current authority, aggregates and audit) rather than resetting the full timeout per statement. Roll back on exhaustion; return bounded503 without data or a committed access event. Keep the existing five-second lock bound where stricter. Avoid new public tuning surface. Known-abandoned responses must not start further aggregate/audit work; active SQL remains bounded by the remaining budget. Clean up listeners/clients reliably. Add a fast controlled-clock/statement test that individually short operations cumulatively exhaust the budget, plus no-audit and released-lock/recovery assertions.
- API coverage: exact nonzero pending investigations across all five states with unrelated selected dates; stock receipt/dispense/adjustment events immediately before/at/after half-open boundaries; all roles on populated aggregate sources with no unauthorized aggregate execution; complete audit metadata for a pharmacist later page and distinctive range; mutation remains blocked between report sections and through audit commit.
- Browser coverage: failed later-page retry retains page and date edits reset it; exact large decimal-string money and distinguishable current stock categories/signed movement columns with units; result heading remains focused and in viewport after paging; delayed response cannot restore results after navigation or cross-tab logout. These are concrete source/permission/recovery checks, not cosmetic implementation mirrors.

- Preparation clarifies laboratory access is denied; report audiences are explicitly enumerated. Inventory exclusions use mutually exclusive eligibility precedence matching the implemented stock read: inactive, quarantined, expired, expiry today, available. Period movement quantities remain per product/base unit.

## Review Triage Log

All three layers returned before triage. Fresh threads were unavailable: two non-implementer reviewers and the implementer verification-gap thread were reused. The edge reviewer disclosed that the diff included the claims spec before its separate claims pass. These limit independence; no layer was represented as context-free.

| Finding | Verdict and evidence | Resolution |
| --- | --- | --- |
| Blind1 later-page retry | medium: error clears report and Retry calls run() defaulting to1; failed target is lost | Preserve requested page; dates/new run reset explicitly |
| Blind2 invisible result focus | false: root browser probe after long25-row pagination confirmed focused result heading inside viewport on desktop(top669.5/bottom694.7 of900) and mobile(top743.3/bottom768.5 of915). Clearing prior report shrinks scroll extent before replacement. | No production focus change; retain focus/visibility assertion in browser coverage |
| Blind3 cumulative execution time | medium: five-second lock and ten-second per-statement limits permit a whole report to outlive the15-second browser timeout while holding the hospital lock | One total execution budget covering acquisition/queries/audit; stop known-abandoned work before further aggregation/audit |
| Blind4 positive investigations | medium: only zero pending-investigation results asserted; constant-zero regression survives | Exact positive count across ordered/collected/released versus reviewed/cancelled states |
| Blind5 stock event boundaries | medium: today and unrelated empty period do not distinguish exact start/end inclusion for movements | Dated receipt/dispense/adjustment event boundary coverage |
| Blind6 populated projections/query exclusion | medium: role key projections run against empty data; unauthorized-query avoidance lacks a direct guard assertion | Populate role matrix and observe that restricted roles execute only authorized aggregates |
| Blind7 large display arithmetic | medium:12345 minor-unit UI check cannot detect a later lossy Number conversion despite exact string contract | Browser exact money beyond safe-integer and signed stock display assertions |
| Blind8 full audit attribution | medium: row count/actor/time assertions omit requested page, dates and captured role/name | Complete later-page restricted-role audit metadata assertion |
| Blind9 lock duration evidence | medium: snapshot gate only precedes all aggregates and races stock | Gate between sections and at audit before commit; payment/visit mutation remains blocked |
| Blind10 delayed response lifecycle | medium: no report-specific delayed-response navigation/logout regression despite privacy-sensitive result state | Delayed response cannot restore content after leaving or cross-tab logout |
| Edge1 cumulative deadline | medium: same separately verified timeout mismatch as Blind3 | Same total-budget correction |
| Edge2 more than250000 products | low: beyond page10000 Next would produce the generic range error, but requires an unsupported catalog far beyond this customer scope | Rejected under low/unlikely-use rule: new capacity branches/disclosure not justified; no capacity claim made |
| Verification1 investigations | medium: preverified constant-zero mutation would pass | Same exact positive investigation-state test |
| Verification2 attribution | medium: preverified persisted page1 mutation would pass later-page test | Same complete audit metadata test |
| Verification3 displayed stock columns | medium: preverified swapped available/quarantined arrays retain headings and API results | Distinct categories and signed movements asserted by browser column |

Accepted findings group into retry recovery, total report budget, and verification coverage. They refine the non-frozen implementation requirements (bad_spec); retain verified implementation and re-derive affected paths incrementally, without destructive reversion of unrelated working code. No accepted finding is deferred.

## Verification

Planned required checks (results must be recorded after execution):

- `npm run typecheck`, `npm run typecheck:server`, `npm run build`.
- `npm run test:server` includes reports and regression.
- `npm run test:staff -- tests/reports.spec.ts` for desktop/mobile with captures.

Root release evidence (initial implementation):

- Packaged HTTPS build/verifier passed: report operations +1 opened/closed/amendment/correction; two receipts total13000 minor units split5000 cash/8000 transfer; unchanged completed-work/current balance; product received10/supplied4/current available6.
- Report audit IDs are checked through restricted runtime SQL and included in30 persisted record groups, with backward compatibility for earlier rehearsal records. Runtime UPDATE/DELETE of report access events is denied. Built browser opens the report form, submits dates and displays results without runtime errors.
- Pilot workbook now contains a concrete synthetic source-to-report reconciliation walkthrough. Security evidence and migration documentation updated; live hospital acceptance remains unsigned.

Implementation verification — 2026-10-14:

- Full API regression: 132/132 passed, including all12 report cases. Report checks cover strict four-digit Gregorian years0001–9999, leap/366-day and Addis boundaries; independent opened/closed/correction timestamps; partial cash/manual-transfer receipts, void/legacy exclusions and exact monetary totals above32bit; partial supply/latest correction reviews including closed visits; populated foreign-hospital operations, finance and inventory isolation; disjoint stock eligibility and3-billion-unit aggregates; pagination; audit failure/immutability; all roles and post-lock revocation; concurrent snapshot serialization and bounded503.
- Frontend and server typechecks and production build passed. Browser report coverage passed8/8 across desktop/mobile for keyboard/axe, all role projections, exact money and paging, empty/loading/error/retry, stale-read cancellation/date edits, dirty-navigation and session clearing. Initial fixture SQL casts and sign-in selector punctuation were corrected before the passing runs.
- The single Impeccable detector run completed with zero findings or advisories. First capture inspection identified inherited uppercase row-header styling and unnecessary mobile receipt scrolling; a local CSS correction uses incumbent13px body typography and a compact receipts table. Final browser checks passed8/8 again after this correction; production build passed again. All14 final captures in `artifacts/reports-ui/{desktop,mobile}-{combined,empty,loading,error,clinician,cashier,pharmacist}.png` were opened and inspected. Independent finish review and root release/restore/security checks follow this implementation handoff.

- Root isolated restore passed for35 application tables, matching schema, counts and content digests. Final independent code/visual review, source scan and reviewed packaged release/restart remain root-owned follow-up checks.

- Root final pre-review packaged release passed before and after complete stop/start, including30 persisted groups and built report UI. Later review corrections require their affected recheck;35-table restore remains valid unless schema changes.

Review correction implementation verification — 2026-10-14:

- Failed-page Retry now retains the requested inventory page; date edits and explicit Run report reset to page1. Existing focus behavior is unchanged and browser assertions verify the result heading is focused and inside the viewport after paging/retry.
- Internal `server/report-budget.ts` applies one monotonic10-second budget before pool acquisition. A wall deadline covers acquisition/SQL/cleanup; each active statement receives only remaining time, retaining the stricter five-second lock limit. Exhaustion or known abandonment destroys the transaction client; pending acquisitions release their late client. Entry checks also detect an already-aborted request or destroyed response. Listeners are removed in all completion paths. No schema or public configuration change.
- All21 report API cases passed across bounded runs: the20-case run passed19 cases; its investigation fixture initially used an unsupported catalogue name, then a duplicate order, and passed after using separate visits with the supported Blood count investigation. The additional mid-report disconnect case passed separately. New evidence covers nonzero investigation states, each stock movement immediately before/at/after both period boundaries, populated role projections with unauthorized aggregate execution excluded, full pharmacist page2 audit metadata, and payment blocking between report sections and through audit commit.
- Deadline checks use controlled monotonic time to accumulate individually short queries; real PostgreSQL statement timeout and subsequent stock-write recovery also pass. Pending-pool deadline, late acquisition release, already-abandoned entry and mid-report disconnect checks verify no further aggregate/audit work and listener/client cleanup.
- Updated browser suite passed14/14 across desktop/mobile, including exact current stock columns with distinct values/base units and signed movements, money beyond Number precision, failed later-page retry/date reset, focus/viewport, and delayed completed responses after navigation/cross-tab logout. All14 existing captures were refreshed; affected combined desktop/mobile captures were inspected with the richer stock fixture.
- Frontend/server typechecks, production build and `git diff --check` passed after the corrections. No second detector run or visual-system change. Root owns independent follow-up review and final packaged release/source checks; previous35-table restore remains applicable because schema did not change.

Final local acceptance — 2026-10-14:

- Both non-implementer follow-up reviewers confirmed all accepted findings resolved and no material introduced regression. Their review was static; the focused execution evidence above remains separate.
- Impeccable finish review opened all 14 refreshed captures and returned **ship**, with no material fixes. Documenter returned no design-system change. Established typography, role projections, truthful states and contained mobile table scrolling were retained.
- Staged source security passed: Semgrep scanned 148 targets with zero findings. Its scanned-path output explicitly includes the report route, budget helper, shared contract and report component.
- Final corrected Docker release rebuilt successfully and passed the complete HTTPS verifier, including audited report reconciliation, restricted runtime history permissions, prior-run persisted record digests, browser sign-in/refresh/report/sign-out and outage recovery. Earlier complete stop/start and 35-table restore evidence remain applicable; no schema changed during correction.
- Scope complete locally; the exact committed revision must also pass GitHub CI. Commercial release and hospital acceptance remain outside this engineering completion, with concrete gates in docs/hospital-pilot-acceptance.md.
