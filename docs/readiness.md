# Release status and acceptance

The current product-completion changes are implemented locally and undergoing
combined verification. They are not yet a verified committed release. The last
passing committed baseline is 65bb78c; its [CI run](https://github.com/yotors/medi/actions/runs/38584302746)
predates the new care, departmental, governance and production-installer changes.
Current acceptance and test results belong in the
[completion specification](../_bmad-output/implementation-artifacts/spec-product-completion.md).

The single authenticated app now includes patient registration and audited identity
corrections, outpatient encounters, appointments, triage, admissions/beds/nursing,
medication administration, referrals, laboratory specimens/results, pharmacy
procurement/returns, invoices/refunds/cash shifts, operational reports, hospital
settings, controlled support and governed record exports. See the
[coverage statement](product-roadmap.md) and [architecture](architecture.md).

Final engineering gates are type/unit/API/browser/accessibility checks, independent
review of the final fixes, source/dependency/web security triage, packaged restart,
immutable-schema upgrade, encrypted recovery, production installation and exact
revision CI. Earlier slice evidence remains historical; it does not automatically
verify later changes. See [security evidence](security-evidence.md),
[MFA verification](staff-mfa-verification.md), and [operations](production-operations.md).

Before a hospital uses live records, its clinical and operational leads must accept
workflows, permissions, catalogs, escalation and report definitions. Applicable
Ethiopian privacy/data-location requirements need qualified review. These decisions
cannot be supplied by public research or a student project. No live patient data,
hospital sign-off or blanket compliance claim is included in engineering evidence.

Deployment requires a host and budget, domain/DNS/TLS contact, named administrator
and operator, protected alert destination, independent backup storage/key custody,
retention policy and a measured restore target. The [installation guide](deployment.md)
provides concrete commands and refuses invented or unsafe configuration. Local
engineering does not require a cloud database; PostgreSQL Docker is already used.
Branch protection and human incident escalation remain operator/account settings.
