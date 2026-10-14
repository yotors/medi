# Medi product delivery status

Updated: 2026-10-14. Medi's objective is a commercial hospital management product
for multiple independent Ethiopian hospitals and medical centers. The current
outpatient implementation is its first development milestone. It is not the
whole product or a sellable hospital installation.

The [whole-product requirements draft](../_bmad-output/planning-artifacts/prd/prd-medi-2026-10-13/prd.md)
defines the proposed capabilities, acceptance scenarios and unresolved decisions.
It is a planning baseline, not hospital approval or evidence of implementation.

The sequence below is a proposed engineering order under the founder's
authorization to continue development. Clinical rules, purchasing requirements
and the first hospital's module coverage still require validation. No calendar
deadline, contract scope or production capacity is implied.

## Current capability versus product work remaining

| Area | Implemented now | Required next or before the relevant release |
| --- | --- | --- |
| Browser workspace | Responsive light/teal staff UI with keyboard and automated accessibility checks | Broader assistive-technology review, localization and role-specific workflow validation |
| Identity and hospital boundary | Individual logins, required production MFA, private recovery, seven preliminary roles, scoped API responses and cross-hospital tests | Validated permissions, separate vendor support controls and database row-policy defense in depth |
| Hospital administration | Hospital-scoped staff directory, onboarding, roles/status, credential reset, password replacement and administrative history; secure CLI bootstrap; departments and immutable service-price versions/history | Branch structure, broader hospital settings and validated permission policy |
| Patient registration | Directory/search, MRN, duplicate-name warning and check-in | Safe demographic corrections, identity reconciliation, provisional/urgent identity, merge governance and migration |
| Clinical encounters | Authored notes, append-only note amendments and encounter history, pending-work blockers | Validated clinical forms, triage/observations, accountable signing, broader responsible follow-up and urgent-care/downtime procedures |
| Laboratory | Order, collection, release and clinician-review handoffs; immutable result corrections with assigned review/takeover, including closed visits | Test catalog/units, specimen rejection/recollection, critical-finding escalation, professional validation and external reports |
| Pharmacy | Hospital products/batches, receipt and adjustment ledger, explicit clinician quantity authorization, partial/full supply and remainder cancellation; expiry/quarantine and concurrent stock guards | Validated formulary/clinical policy, procurement, controlled items, patient returns, pack conversion, multiple stores and valuation |
| Finance | Versioned catalog invoices, partial cash/manual-transfer records, stable receipts, unpaid invoice voiding and immutable financial history; separate clinical closure | Validated statutory formats/tax policy, discounts/refunds/reversals, shift reconciliation and financial controls |
| Scheduling/inpatient | Not implemented | Validate appointment and admission/transfer/discharge, bed, nursing and medication-administration coverage before claiming these modules |
| Reporting/integrations | Audited role-scoped visit activity, current outstanding work, exact receipt totals and per-product stock/movement reports | Hospital validation of report definitions, governed exports; payer, payment and statutory interfaces only against verified contracts |
| Operations | Local Docker DB, built HTTPS installation, restricted runtime grants, checked migrations, encrypted source-offline recovery, private monitoring/alert drills, upgrade/replacement rehearsal and measured synthetic capacity | Production installation acceptance, human alert escalation, operated offsite recovery/key custody, support and hospital-specific capacity targets |

## Delivery milestones and exit evidence

1. **Outpatient development foundation — complete within its recorded scope.**
   Registration through visit closure persists on the server, with transactional
   commands, attributable changes and role checks. Evidence: the
   [implementation specification](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md)
   and [passing GitHub run](https://github.com/yotors/medi/actions/runs/38390211322).
   Production requirements above are not completed by this milestone.

2. **Hospital administration and access — staff account slice implemented.**
   Hospital-scoped onboarding, role/status updates, temporary credentials, required
   password replacement, revocation and attributable history are implemented.
   Revision checks, rollback and hospital-lock authorization rechecks protect
   overlapping commands. Evidence and remaining limits are recorded in the
   [staff administration specification](../_bmad-output/implementation-artifacts/spec-staff-administration.md).
   Departments and versioned ETB service settings/history are also implemented;
   catalog prices now supply explicit invoices for new encounters. Historical demo
   records remain unchanged. Branch
   structure and validated permissions remain outstanding. Required production MFA and private recovery are implemented; see [MFA verification](staff-mfa-verification.md).

3. **Operational outpatient product — in progress.**
   Complete patient corrections, broader lab and pharmacy requirements, and
   financial controls. Note amendments and corrected-result review are implemented;
   their clinical workflow validation remains open. Pharmacy stock, batch eligibility and partial supply are implemented; see the [inventory specification](../_bmad-output/implementation-artifacts/spec-pharmacy-inventory.md). Catalog invoices and partial payment records are
   implemented; see the [billing specification](../_bmad-output/implementation-artifacts/spec-outpatient-billing.md). Test realistic multi-role
   exceptions: result correction, partial dispensing, duplicate payment retry,
   refund, concurrent last-stock dispense and interrupted work. Clinical closure
   and debt handling need independently validated policies. Departmental users
   must review the workflows before a live pilot.

4. **Repeatable installation — local rehearsal implemented; staging pending.**
   Built web/API/database containers, separate private configuration, runtime
   privileges, controlled migrations and HTTPS are implemented. The verifier
   exercises synthetic workflows with restricted credentials and checks restart
   persistence. Encrypted recovery now verifies a consistent snapshot, schema/data/grants and source-offline restoration; its delivery CI passed. Upgrade/replacement rollback and private monitoring/alert drills now pass locally; a declared 10-session synthetic capacity run passed. See [operations evidence](production-operations.md). Operated offsite recovery and hospital acceptance remain. Staging uses synthetic records. Founder infrastructure decisions
   occur at the triggers in [deployment.md](deployment.md), not upfront.

5. **Accepted pilot and first commercial release — not yet reached.**
   Agree the actual facility/module coverage, collect clinical/operational and
   appropriate legal review, complete applicable security controls, measure
   workload/recovery against agreed targets, rehearse import and downtime,
   train users and assign support/incident owners. Release requires recorded
   acceptance, not merely green CI. If a hospital depends on inpatient,
   insurance or other missing modules, those become prerequisites for that
   customer's launch rather than silently unsupported work.

6. **Broader hospital coverage — scope-dependent.**
   Deliver inpatient/nursing, scheduling, insurance, device/national integrations
   and additional languages according to validated customer needs. Each module
   needs workflow ownership, permission/data boundaries and release evidence.
   An outpatient release must be sold with an explicit coverage statement.

## Working agreement

- Keep one reusable product with controlled hospital configuration.
- Use synthetic data until the live-pilot gate is satisfied.
- Maintain explicit implemented, partial and not-started statuses; do not present
  a handoff screen as a complete departmental module.
- Continue local engineering without requiring cloud accounts. Give the founder
  a concrete infrastructure plan when a deployment decision becomes necessary.
- Treat public research and the student project as discovery inputs, not
  hospital acceptance. The founder does not need to invent clinical rules.
- Track release evidence in [readiness.md](readiness.md) and behavior/limits in
  [staff-workspace.md](staff-workspace.md).
