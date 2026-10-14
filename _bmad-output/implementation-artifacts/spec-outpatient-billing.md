---
title: Catalog invoices and partial outpatient payments
type: feature
created: 2026-10-13
status: done
route: dispatch
review_loop_iteration: 0
baseline_commit: 324c69e40485c2219b6c0d02d375d174bfd0080e
context: [AGENTS.md, PRODUCT.md, DESIGN.md, docs/product-roadmap.md]
---

<frozen-after-approval reason="Founder authorized continuing the real hospital product and local synthetic development">

## Intent

Replace invented charges in new staff encounters with explicit catalog invoices
and partial cash/manual-transfer records. Preserve historical demo encounters and
the browser-only prototype. Clinical record closure and financial collection are
separate: closing clinical documentation never fabricates a payment, implies an
unprepared bill is paid, or prevents later authorized collection.

## Boundaries & Constraints

Always use hospital-scoped transactions, current authority after hospital-first
locks, immutable issued lines/payments/history, actor-bound idempotency, revisions,
server-resolved price versions and integer ETB. New clinical encounters have an
explicit catalog mode and no automatic consultation/test charges. Keep clinical
pending-work checks; show clinical and billing status separately. Label old
financial records as demonstrations. All development remains synthetic.

Never convert invented historical payments into real receipts, insert dummy
charges/payments to bypass old invariants, infer service mappings from names, or
invent tax, insurance, treatment, discount/refund policy or payment integrations.
Manual transfer records document an operator's action; they do not verify a bank
transaction. Statutory invoice formats and hospital policies remain pilot gates.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Expected behavior | Error |
| --- | --- | --- | --- |
| New/legacy | Check-in after upgrade / existing demo record | New catalog mode, unchanged historical behavior | No automatic invented charges |
| Issue | Admin/cashier selects active service versions/quantities | Immutable lines, invoice identity, actor/time, accurate total | Stale/foreign/inactive selection rejected |
| Partial payment | Cash/manual transfer, exact amount/reference | Stable receipt, reduced balance; no full-charge paid flags | Reject zero/negative/overpayment or missing transfer reference |
| Void | Admin, unpaid invoice, reason and revision | Preserve original and record void; allow replacement | Reject paid or stale invoice |
| Concurrent/retry | Duplicate key, changed payload, concurrent payments | One effect/receipt, no overpayment, original operation identity | Conflict or safe retryable failure |
| Isolation/rollback | Wrong role/hospital, revoked waiting actor, audit failure | No forbidden data, mutation or partial ledger | 401/403/404; rollback |
| Clinical close | Clinical tasks complete, bill unpaid/unprepared | Close clinical record; billing remains visible and collectable | Pending clinical tasks still block clinical close |
| Browser | Empty catalog, stale price, dirty/uncertain action, session loss | Preserve draft/exact retry, guarded navigation, clear session data | Accessible recovery on desktop/mobile |

</frozen-after-approval>

## Code Map

`src/domain.ts` couples charges, whole-charge payments and closure; cancellation
dereferences an order charge. Preserve legacy execution; add genuine catalog
clinical rules. `server/outpatient.ts` and `shared/outpatient.ts` project this
model. Closed visit JSON is immutable, so collection needs separate tables.
Configuration exposes active services and immutable service-price versions.
`VisitPanel.tsx` owns billing; `VisitWorkspace.tsx` guards drafts/exact retries.

## Tasks & Acceptance

- [x] Backend: `shared/billing.ts` strict commands/DTOs; publish contract early.
- [x] Backend: `server/migrations/007_outpatient_billing.sql`, `server/db.ts`:
  scoped invoices/lines/payments/events/receipts, stable numbering, immutable
  history; send runtime grants. Preserve old rows and migrations.
- [x] Backend: `server/billing.ts`, `server/app.ts`: paginated protected reads,
  issue/pay/void, bounded transactions, revisions, idempotency and atomic audit.
- [x] Backend: domain/catalog clinical adapter, `shared/outpatient.ts`,
  `server/outpatient.ts`: explicit new mode, separate clinical/billing summaries.
- [x] Parent: `BillingPanel.tsx`, `VisitPanel.tsx`, `VisitWorkspace.tsx`, styles:
  service selection, invoice review, amount/method/reference, receipts/history,
  clear unprepared status, stale/draft/uncertain recovery and navigation guards.
- [x] Backend: `server/billing.test.ts`, affected domain/server tests: matrix,
  legacy/upgrade, SQL immutability, race/retry/rollback and post-close collection.
- [x] Parent: browser tests, package/deploy integration, release verifier, docs,
  integrated checks and independent review.

## Implementation Notes

Backend builder owns shared types, server/migration/tests and domain logic;
parent owns React/browser/package/deploy/docs. No children. Publish types and
grants early; coordinate contract changes. Founder authorized local engineering;
clinical/commercial acceptance remains unresolved.

GET `/api/visits/:id/billing?page=1`: summary and invoice page.
GET `/api/billing/invoices/:id?page=1`: lines and event/payment history page.
POST `/api/visits/:id/billing/commands`: strict unions `invoice.issue`
(lines:serviceId,serviceRevision,quantity), `payment.record`
(invoiceId,expectedRevision,amountMinor,method,reference), `invoice.void`
(invoiceId,expectedRevision,reason). UUID idempotency header; response identifies
invoice/optional stable receipt; fetch current views separately. Read roles:
admin/cashier/auditor; issue/pay:admin/cashier; void:admin. No ledger mutations
for legacy visits; preserve temporary-password gating. Page size25, lines1–20,
unique services, quantities1–100. Invoice and aggregate nonvoid visit total
bounded by999999999 minor units. Zero-price lines allowed, zero payments denied.
Cash reference optional; manual_transfer reference required. States:
unbilled/outstanding/settled. Issued prices survive catalog changes; retries
survive restarts; clinical closure preserves collectible outstanding bills.

## Spec Change Log

## Review Triage Log


| ID | Verdict | Evidence and route |
| --- | --- | --- |
| B1 | medium | Clearing selection aborts detail GET but neither aborted finally nor no-selection branch clears detailLoading. Patch the demonstrated loading reset and cover delayed navigation. |
| B2 | medium | Non-admin configuration detail hides inactive services with404; Promise.all discards all refresh results. Patch per-line unavailable handling, retaining successful price updates and quantity drafts. |
| B3 | medium | Refresh visit updates outer summary only; the mounted billing panel does not observe it. Patch propagation of a refresh generation and keep drafts. |
| B4 | medium | UUID case variants pass case-sensitive uniqueness and violate SQL uniqueness. Patch UUID normalization before validation/hash; test two duplicates within line cap. |
| B5 | medium | changeView preserves receipt notice across invoice selection. Patch notice clearing on explicit financial navigation. |
| B6 | medium | Catalog queue performs25 sequential aggregate reads while holding hospital SHARE. Patch one batched aggregate for the selected page; verify queue balances. |
| B7 | low | A direct SQL insert can fabricate balanced line snapshots; current billing writer always resolves immutable versions and exposes no arbitrary snapshot input. Reject extra schema branches for a hypothetical future writer; no current application path violates captured catalog values. |
| B8 | low | Direct SQL can mismatch payment/event actor fields; the sole current financial writer sets both from the same freshly authorized actor. Reject additional guards for a hypothetical second writer, beyond existing immutable scoped ledger constraints. |
| B9 | medium | Browser unknown-outcome checks covered payments only; issue/void have separate draft/notice paths. Patch lost-response cases for each with one-effect/key assertions. |
| B10 | low | Cashiers can select All/Closed and see unbilled/outstanding balances; closure does not hide or prevent retrieval. A financial-only queue filter is a useful later convenience, but no inaccessible record is demonstrated. Reject new filter/API complexity in this correction; broader financial operations remain roadmap work. |
| E1 | medium | Same404 refresh failure asB2 verified in readEntry non-admin behavior. Patch per-line unavailable handling. |
| E2 | medium | Same case-variant duplicate validation failure asB4. Patch canonical UUID handling. |
| E3 | medium | Accepted uppercase visit path hashes raw input, then exact retry compares lowercase stored UUID to raw path. Patch canonical path/key/command UUIDs and test replay. |
| V1 | medium | Preverified regression gap: queue tests never assert billed/partially paid/closed/settled row amounts. Patch queue assertions alongside batch enrichment. |
| V2 | medium | Preverified broken test:21 duplicate lines fail length before uniqueness. Patch two-line duplicate contract/API assertions, including case variants. |

## Verification

Both typechecks; prototype/domain, API and browser matrix tests; PostgreSQL races,
SQL grants, migration/restore; built HTTPS before/after restart; security scans and
independent review. No statutory invoicing or live-care readiness claim.


### Review fixes and local evidence — 2026-10-14

The three BMad layers returned15 individual findings; each is classified above.
All accepted findings were patched. A fresh independent patch reviewer found all
accepted items resolved and no material regression. No accepted finding was deferred.
The scoped Impeccable review returned `disposition: ship` for desktop/mobile paid
invoice/history and stale-price draft captures. Payment-entry behavior was tested;
its visual layout was source-reviewed, not a separate captured state. The documenter
checked the source and incumbent design files and found no durable system change.

- Full API baseline80/80 passed before review corrections. Final focused billing+
  outpatient API35/35 passed, including3 new UUID/queue regressions. Full CI now
  includes83 API cases.
- Billing browser26/26 passed on desktop/mobile, including issue/payment/void
  lost responses, delayed reads, stale/retired catalog recovery, role controls,
  closed-visit collection, pagination, draft/session guards and acknowledged-write
  read failure. Captured invoice/draft views pass axe and document-width checks.
- Other changed outpatient browser cases passed:14 existing cases plus2 corrected
  keyboard journey cases. Original prototype/domain unit16/16 passed.
- Both TypeScript checks and built web/API compilation passed. Source scan119
  targets,0 findings; new application/contract/backend test files confirmed in
  its scanned list. Browser spec files follow the existing scanner exclusion.
  Container dependency audit reports0 vulnerabilities; dependency versions unchanged.
- Migration007 and upgrade/replay preservation passed. Disposable restore verified
  all24 tables, schema, row counts and content digests; source database unchanged.
- Built HTTPS release verification passed before/after full stop/start, including
  retained prior13 record groups plus6 financial groups, restricted runtime grants,
  invoice/partial cash/manual transfer, original retry receipt identities, session,
  CSRF/Origin, database outage/recovery and browser sign-in/refresh/logout.
  The final patched image was rebuilt and passed verification again.

Two browser fixtures initially omitted the required clinical note; corrected the
fixtures rather than weakening closure. The enlarged billing suite exceeded the
shared fictional account's login budget; each independent test now clears only
its three fixture-account buckets after the dedicated local fixture guard. Runtime
limiter behavior is unchanged and covered by isolated API tests. The resumed
backend typecheck exposed inferred UUID-template types in test helper keys;
explicit string annotations permit the deliberately uppercase cases.

The administration/configuration baseline324c69e has a confirmed passing GitHub
run38404991564. Billing's pushed commit will run the full CI checks. No production
hospital, statutory invoicing, payment-provider, capacity or live-care readiness
claim is made. Broader product requirements remain in docs/product-roadmap.md.

The first parallel prototype browser attempt lost its shared Vite server when
billing verification completed. This was a harness ownership conflict; the
prototype suite was restarted independently. No application change was made for
that connection-refused run.

Final independent prototype browser run:12/12 passed in1.3m.
