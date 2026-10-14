# Product coverage

Medi targets small private hospitals and medical centers in Ethiopia. One reusable
web application serves each configured hospital; dedicated installations can run
on a hosted or hospital-local Linux host. The English UI uses a calm light/teal
workspace; record dates can use English/Amharic locale and Gregorian/Ethiopic display.
This does not constitute a fully translated Amharic interface.

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

Insurance claims, national/device interfaces, offline synchronization and full UI
translation are not implemented. They require verified external contracts and
customer scope. Existing financial reports summarize source transactions rather
than audited statutory accounts. Configurable forms do not encode unvalidated
clinical recommendations.

Current combined engineering verification is tracked in [readiness](readiness.md)
and the [completion specification](../_bmad-output/implementation-artifacts/spec-product-completion.md).
Historical slice specifications remain evidence for their recorded revisions.
A commercial deployment also needs hospital acceptance, training, import/downtime
rehearsal, support ownership and qualified review of applicable obligations.
