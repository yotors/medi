# Release status and acceptance

The workspace appearance/navigation update adds Light/Dark/Device modes, three
accent palettes, accessible language/appearance menus and a header profile menu
for password, MFA and sign-out. Department section links retain guarded drafts
and stable loading. Local browser, accessibility, localization and real dark-mode
MFA checks passed; the final packaged verification is recorded in the
[implementation specification](../_bmad-output/implementation-artifacts/spec-workspace-appearance-navigation.md).
GitHub verification for this update remains **pending**; delivery does not wait
for CI and does not assume a pass. Earlier release evidence below is historical.

The bilingual experience update is **6bc9548**: public product homepage, role-based
workspace routes, English/Amharic catalogs, shared locale formatting and local QR
MFA enrollment. Local format/type/build, catalog/source checks and targeted
desktop/mobile regressions passed. The local HTTPS package was rebuilt. Full
GitHub verification of this revision is **pending**; at the founder’s request,
delivery proceeds without waiting for its outcome. No passing result is assumed
as evidence. The prior revision’s security and packaged-release jobs passed; its
browser failures were corrected and the affected scenarios passed locally.
See the [language and navigation guide](ui-navigation.md).

The product-completion engineering release is **80f9b60**. All three configured
GitHub jobs passed for that exact revision: application/tooling, source security,
and packaged installation/release operations.
[Verified CI run](https://github.com/yotors/medi/actions/runs/38615699574).
This verifies the delivered software and documented synthetic workload; live
hospital acceptance and the deployment inputs below remain operator decisions.
The [completion specification](../_bmad-output/implementation-artifacts/spec-product-completion.md)
records local results, corrected failures and review evidence.

The single authenticated app now includes patient registration and audited identity
corrections, outpatient encounters, appointments, triage, admissions/beds/nursing,
medication administration, referrals, laboratory specimens/results, pharmacy
procurement/returns, invoices/refunds/cash shifts, operational reports, hospital
settings, controlled support and governed record exports. See the
[coverage statement](product-roadmap.md) and [architecture](architecture.md).

The passed engineering gates include type/unit/API/browser/accessibility checks, independent
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
