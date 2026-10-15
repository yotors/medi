# Product coverage

Medi targets small private hospitals and medical centers in Ethiopia. One reusable
web application serves each configured hospital; dedicated installations can run
on a hosted or hospital-local Linux host. The English/Amharic UI uses a calm light/teal workspace. Record dates can use
English/Amharic locale and Gregorian/Ethiopic display independently of interface
language. Fluent clinical terminology review remains part of hospital acceptance.

| Area | Implemented capability | Customer-specific acceptance or extension |
| --- | --- | --- |
| Access | Individual accounts, eight roles, mandatory production MFA, recovery, hospital-scoped API/RLS, expiring auditor-only support | Accept permission policy and account/key custody |
| Patients | Registration/MRN/search, audited demographic/allergy profiles, identity links and retained original histories | Import/migration, duplicate-resolution policy |
| Care | Appointments/arrival, triage/vitals/amendments, encounters, admissions/beds/transfers/discharge, nursing, medication orders/outcomes, referrals/follow-up | Clinical templates, emergency/downtime and escalation procedures |
| Laboratory | Configured tests, specimen collection/receipt/rejection/recollection, versioned results, critical-result review and corrections | Professional validation, reference ranges and instrument interfaces |
| Pharmacy | Products/batches, stock ledger, partial dispensing, purchasing approvals/receipt, pack units, controlled authorization, quarantined returns/quality disposition | Formulary, controlled-item policy, multiple stores/valuation |
| Finance | ETB catalog invoices, partial payment/receipts, credits/discounts/refunds/reversals, cash allocations and shift reconciliation | Statutory/tax formats, accounting/payer integrations |
| Governance | Hospital/facility settings, audited exports, record authority requests, holds and support windows | Retention and legal policy; no automatic record destruction |
| Operations | Immutable images, private secrets, restricted runtime DB, migrations, HTTPS, telemetry/alerts, encrypted snapshot/recovery and scheduler templates | Host/domain, actual offsite mount, human escalation, measured recovery/capacity |

Insurance claims, national/device interfaces and offline synchronization are not
implemented. They require verified external contracts and
customer scope. Existing financial reports summarize source transactions rather
than audited statutory accounts. Configurable forms do not encode unvalidated
clinical recommendations.

Current combined engineering verification is tracked in [readiness](readiness.md)
and the [completion specification](../_bmad-output/implementation-artifacts/spec-product-completion.md).
Historical slice specifications remain evidence for their recorded revisions.
A commercial deployment also needs hospital acceptance, training, import/downtime
rehearsal, support ownership and qualified review of applicable obligations.


## Product follow-up issues

These issues describe planned extensions, not shipped functionality:

- [Visual analytics workspace](https://github.com/yotors/medi/issues/2): defined metrics, trends, comparisons and accessible tables backed by authorized, reconciled report data.
- [Patient-data import](https://github.com/yotors/medi/issues/3): private dry-run validation, identity conflicts and attributable migration reconciliation.
- [Work inbox](https://github.com/yotors/medi/issues/4): role-scoped discovery of pending reviews and overdue handoffs, preserving clinical acknowledgement rules.
- [Hospital onboarding and installations](https://github.com/yotors/medi/issues/5): repeatable setup, acceptance, updates, recovery and support custody.
- [Ethiopian payment integration](https://github.com/yotors/medi/issues/1): verified provider settlement, idempotency, reconciliation and refunds.
