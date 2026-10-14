---
title: Complete hospital laboratory pharmacy and financial controls
status: implemented
baseline_commit: deaad870638655e5b8a313ce3319e27e072777f9
context:
  - AGENTS.md
  - PRODUCT.md
  - DESIGN.md
  - server/auth.ts
  - server/billing.ts
  - server/inventory.ts
  - shared/billing.ts
  - shared/inventory.ts
  - src/staff/api.ts
  - _bmad-output/implementation-artifacts/spec-product-completion.md
---

# Goal

Complete operational exceptions currently missing from laboratory, pharmacy and
finance. Implement server/departments.ts, shared/departments.ts,
src/staff/DepartmentWorkspace.tsx/departments.css, migration017_departments.sql
and focused tests. Root owns app route/nav wiring, hashes/grants and role lists.
You may extend existing billing/inventory summaries and their relevant UI when
needed for correct net balances, while retaining historical immutable records.
Do not edit root-owned app.ts/StaffApp.tsx/schema-manifest.ts/runtime-grants.ts,
care builder files or any historical migration. No nested agents/commits/push.

## Required workflows

1. Laboratory: hospital-configured test catalog with code/name/specimen/unit and
   optional operator-configured critical thresholds (no invented defaults).
   Link existing encounter lab orders where possible. Specimen registration and
   accession, collection event, receipt, explicit rejection reason/recollection,
   result entry and release require responsible author/time and retained versions.
   Prevent release from a rejected/uncollected specimen. Manual critical flag or
   explicitly configured value rule creates an escalation task with assigned
   clinician, acknowledgement/delivery record and closed-loop status. Corrected
   result preserves original and reopens accountable review; current correction
   mechanisms must continue to work. No automatic external messages.
2. Pharmacy: supplier directory and purchase request/order lines with explicit
   product/unit/quantity/cost, approval, partial receipt and remainder cancellation.
   Receipt uses existing stock batch/immutable movement mechanisms atomically,
   preserves supplier/PO linkage and guards overreceipt/idempotent retry. Record
   patient returns against actual dispenses; cumulative return never exceeds
   supplied quantity. Returned drugs default to quarantine, require explicit
   authorized quality decision before restock, and never silently increase usable
   stock. Preserve batch identity/expiry, movement lineage and report reconciliation.
   Controlled-item flag and explicit responsible authorization must be available;
   pack conversion uses configured positive integer quantities, no guessed units.
3. Finance: immutable invoice credit/discount and payment reversal/refund ledgers
   with reason, actor, approved authority and expected revision. Do not delete or
   edit issued invoice lines, payments or receipts. Prevent credit exceeding
   charge, refund exceeding collected refundable amount, negative/overflow totals
   and duplicate retry. Adjust net due/paid/refunded/outstanding projections,
   invoice page and reporting consistently; one source of minor-unit arithmetic.
   Cashier shifts have opening cash, payment/refund allocations, counted closing
   cash, difference, signed close and manager review; closure locks new allocation
   and preserves audit. Manual transfer references remain explicit. Printable
   receipts/statements are factual, show ETB amounts/ids/actors and reversal links;
   no invented tax registration or compliance claims.

## Security/integrity/UI

Use composite hospital FKs, strict bounded shared schemas, permissions by role
(lab/clinician for lab handoffs, pharmacist/admin for stock, cashier/admin for
finance; auditor reads immutable history). Admin controls catalogs/approvals.
Each read is scoped/bounded and current-actor checked; every mutation rechecks
actor after hospital lock and commits record+audit+retry receipt together. Replay
checks changed payload, stale revision and current authorization. Safe bounded
timeouts return retryable503. Clinical/raw identifiers stay out of request URLs
except stable entity IDs; operational telemetry remains allowlisted.
Frontend must expose actual functional forms/lists/history and clear pending
key/payload, loading/error/empty states, safe draft departure and identity clearing.
Follow existing calm teal workspace with keyboard/mobile usable controls.
No skeleton-only workflows or API-only completion. No simulated payment-provider
integration: recorded cash/manual transfer/refund outcomes are accountable facts.

## Acceptance/tests

Given correct roles/catalog/order/payment/stock, each normal and exception flow
persists with balanced projections and visible history. Rejected specimens cannot
release; critical results require acknowledgement. Concurrent partial receipts,
returns, credits/refunds and shift closure prevent overreceipt/overreturn/
overrefund and duplicate allocation. Identical retries reproduce one result;
changed payload and stale authority/revision reject without mutation. Foreign
hospital/role reads and writes do not expose or change records. Injected audit
failure rolls back every linked stock/financial change and retry receipt.
Focused server tests cover these boundaries and browser spec covers representative
forms end-to-end using synthetic fixtures. Root wires tests/CI. Run affected tests
once; fix failures and report counts plus explicit integration/grant instructions.

## Implementation evidence

- Added shared bounded department command contracts, attributed immutable event/financial/request ledgers, composite hospital links, stock lineage, and migration `017_departments.sql`. Historical migrations are unchanged.
- Laboratory specimen collection/rejection/recollection, release and retained correction versions are functional. Critical or corrected releases create the existing accountable clinical review overlay; delivery acknowledgement closes both handoffs. Root integrated legacy release/closure bypass guards.
- Supplier directory, approved purchase lines/partial receipt/remainder cancellation, controlled-item authorization, configured pack conversion, and quarantined patient returns with explicit admin quality decisions are functional. Inventory reports reconcile patient return quarantine/restock/disposal without adding quarantined returns to usable stock.
- Immutable credits/discounts/refunds/reversals preserve issued lines, payments and receipts. Shared minor-unit projections feed billing summaries, invoices and financial reports. Cash shifts retain unique allocations, signed count/difference and manager review. Invoice/history printing includes factual ETB values, actors, IDs and reversal links.
- DepartmentWorkspace provides role-scoped lists, actual forms, paginated history/choices, retained exact retry key and payload, safe draft departure, loading/error/empty states and identity clearing.
- Focused PostgreSQL departments suite: **11/11 passed**. Affected billing and reporting suites: **41/41 passed**. Frontend and server TypeScript checks passed. Browser cases cover configured catalog/a11y/mobile screenshots, signed cashier close, and pharmacy draft departure. Five requested workflows were verified on desktop/mobile (10 checks); root owns final CI integration.

## Final integrity and product usability fixes

- Initial specimen registration requires an active encounter and an order awaiting release. Collection independently checks encounter/order eligibility; a new specimen cannot introduce an unamended replacement for a closed or already released/reviewed order. Existing released specimens retain correction overlays.
- Encounter orders support hospital-configured laboratory catalog IDs with validated label snapshots. New UI orders select the configured catalog; known historical labels remain accepted for established clients without catalog IDs, while unknown/custom labels require a valid hospital catalog ID. Historical demonstration price guards remain confined to legacy mode.
- Department forms use hospital/role-scoped searchable, paginated choices for patient orders, clinicians, supplier/products/batches, actual dispenses, patient invoices/original receipts, and one cash entry. Search text travels in POST bodies; selections fill hidden identifiers and revisions. Identifiers are available in optional history details. All patient choice joins use the invoker `patient_directory` view, so corrected names and linked canonical MRNs remain visible without changing original encounter/dispense identity.
- Three added focused API regressions passed, including a corrected-name picker assertion. The configured-order/specimen and invoice/refund/cash-entry browser workflows passed on both device projects (4 checks). After fixing native label associations, signed cash-difference formatting and header contrast, the three remaining requested cases passed on both device projects (6 checks). Both TypeScript checks passed; successful desktop/mobile screenshots were inspected.
- No changes to migrations 016–019 during these fixes. Department source is frozen for the final integrated image build.
