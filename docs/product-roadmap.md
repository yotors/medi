# Medi product delivery status

Updated: 2026-10-13. Medi's objective is a commercial hospital management product
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
| Identity and hospital boundary | Individual logins, seven preliminary roles, scoped API responses and cross-hospital tests | Staff lifecycle UI, recovery, privileged MFA, validated permissions, separate vendor support controls and production DB privileges |
| Hospital administration | Hospital/account provisioning through a CLI | Reviewed onboarding, settings, departments/branches and configuration history without per-customer code forks |
| Patient registration | Directory/search, MRN, duplicate-name warning and check-in | Safe demographic corrections, identity reconciliation, provisional/urgent identity, merge governance and migration |
| Clinical encounters | Authored notes and encounter history, pending-work blockers | Validated clinical forms, triage/observations, accountable signing/amendments, responsible follow-up and urgent-care/downtime procedures |
| Laboratory | Order, collection, release and clinician-review handoffs | Test catalog/units, specimen rejection/recollection, result corrections, professional validation and external reports |
| Pharmacy | Prescription and fulfillment/cancellation handoffs | Product catalog, quantities/partial dispensing, batches/expiry, stock movements, returns and concurrent stock integrity |
| Finance | Fixed invented prices and full demonstration settlement | Versioned service tariffs, charges/invoices, partial payments/receipts, discounts/refunds/reversals, shift reconciliation and financial controls |
| Scheduling/inpatient | Not implemented | Validate appointment and admission/transfer/discharge, bed, nursing and medication-administration coverage before claiming these modules |
| Reporting/integrations | Basic visit summaries/history | Agreed operational reports and governed exports; payer, payment and statutory interfaces only against verified contracts |
| Operations | Local Docker DB, migration/integrity tests, restore verification and passing application CI | Deployable release, least privilege, monitoring/alerts, encrypted offsite recovery, upgrades, migration rehearsal, support and measured capacity |

## Delivery milestones and exit evidence

1. **Outpatient development foundation — complete within its recorded scope.**
   Registration through visit closure persists on the server, with transactional
   commands, attributable changes and role checks. Evidence: the
   [implementation specification](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md)
   and [passing GitHub run](https://github.com/yotors/medi/actions/runs/38390211322).
   Production requirements above are not completed by this milestone.

2. **Hospital administration and access — next implementation priority.**
   Define and implement authorized staff onboarding, deactivation/session
   revocation, role changes and audit visibility. Preserve former staff
   authorship; prevent privilege escalation and accidental loss of all hospital
   administrators. Prove changed permissions on subsequent requests and isolate
   every action by hospital. Then add versioned hospital/service configuration.
   The first access slice needs its own implementation specification and tests.

3. **Operational outpatient product — planned.**
   Complete patient/clinical corrections, lab and pharmacy requirements, and a
   real financial ledger with configurable prices. Test realistic multi-role
   exceptions: result correction, partial dispensing, duplicate payment retry,
   refund, concurrent last-stock dispense and interrupted work. Clinical closure
   and debt handling need independently validated policies. Departmental users
   must review the workflows before a live pilot.

4. **Repeatable installation and private staging — planned; can progress alongside milestone 3.**
   Package the application, establish separate configuration and runtime
   privileges, rehearse migrations/rollback, and test HTTPS, monitoring and
   recovery. Staging uses synthetic records. Founder infrastructure decisions
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
