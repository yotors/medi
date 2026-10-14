# Hospital pilot acceptance workbook

Prepared 2026-10-14 for a first Ethiopian private medical-center pilot. This is a
review workbook, not evidence of hospital approval. Use fictional patients in the
walkthrough. Record the exact Git revision, configuration, date, reviewer role,
observed result and linked defect for every scenario. An automated pass does not
substitute for a practitioner observing the workflow.

## Owners and package

Before live use, name the hospital sponsor, clinical lead, registration lead,
laboratory lead, pharmacist, finance lead, privacy/security reviewer, installation
operator and support contact. One person may hold several responsibilities, but
approval must be attributable. Agree which departments are included and explicitly
record services Medi cannot yet support. Outpatient completion does not imply
inpatient, emergency, maternity, theatre or medication-administration coverage.

Record languages, calendars/date formats, opening hours, connectivity, power backup,
printers, workstations, expected daily patients, concurrent staff, retention needs,
legacy import sources and support hours. These are questions for the prospective
hospital, not assumed product capabilities.

## Observed walkthroughs

| Scenario | Reviewers | What must be demonstrated | Approval record |
| --- | --- | --- | --- |
| Register and identify | Registration, clinical | Local naming conventions, age/date precision, similar names, guardian/contact needs and duplicate handling; no unreviewed merge | Pending |
| Check in and consult | Registration, clinical | Returning patient, handoff, required clinical dataset, note provenance, urgent escalation and unfinished work | Pending |
| Correct saved records | Clinical, laboratory | Original remains visible; reason/author/time; corrected result creates fresh accountable review including after closure; absent reviewer takeover | Pending |
| Laboratory | Laboratory, clinical | Specimen identifiers, test definitions/units, result authorization, correction, acknowledgement and critical findings policy | Pending; current engineering flow does not establish critical-value escalation |
| Medicines | Pharmacist, clinical | Approved product/base unit, explicit prescription quantity, partial supply, lot/expiry/quarantine, discrepancy reason and cancellation remainder | Pending; no dosing/substitution advice |
| Finance | Finance | Approved services/prices, separate clinical closure, partial payments, numbered records and source totals | Pending; tax format, refunds, credit and cash-shift reconciliation require their own approval |
| Reports | Service leads, finance | Agreed date/timezone boundaries, period activity versus current backlog, source reconciliation and permitted viewers | Pending |
| Access | Hospital admin, security | Separate staff accounts, roles, joiner/leaver process, temporary password replacement, revoked sessions and vendor support boundaries | Pending; MFA/recovery governance remains open |
| Outage | All affected leads, operator | Power/network/database loss, uncertain save, safe retry, paper fallback, later reconciliation with original occurrence time | Pending; offline multi-device writes are unsupported |
| Customer separation | Operator, security | Two fictional hospitals; no cross-hospital reads, writes, reports or support access; agreed tenancy model | Pending |
| Upgrade and recovery | Operator, sponsor | Backup before upgrade, isolated restore, integrity comparison, rollback decision and measured elapsed recovery | Pending |

For each walkthrough write: **accepted / changes required / not in package**.
A blocked scenario needs an owner, corrective action and repeat observation.
Do not accept missing care documentation by treating it as a cosmetic defect.

## Installation decision record

Choose after the hospital's connectivity and operating responsibilities are known:

- **Hosted:** identify approved data location, hosting account, domain, internet
  dependency, restricted support access and independently stored backups.
- **Hospital-local:** identify hardware owner, protected room, power backup,
  LAN/DNS/certificate arrangements, offsite backups and remote-support procedure.
- **Hybrid:** define the exact data flow and conflict/reconciliation design first.
  Medi currently has no offline replication engine; hybrid is not an available
  deployment switch.

The local Docker installation can rehearse packaging and persistence. It does not
supply a production domain, public certificate, alerting service, offsite backup,
legal approval or support agreement. No hosting purchase is needed to continue
local development. See [deployment procedure](deployment.md).

## Evidence required before live records

| Gate | Concrete evidence to attach | Decision owner |
| --- | --- | --- |
| Workflows | Completed walkthroughs, approved department coverage and clinical forms/policies | Hospital clinical and service leads |
| Privacy and record governance | Applicable Ethiopian requirements reviewed; data location, access, retention, legal holds and record-request procedure | Qualified local reviewer and hospital |
| Security | Threat assessment, applicable ASVS mapping, tenant/role tests, privileged-access and recovery review, triaged findings | Security reviewer |
| Backup/recovery | Encrypted independent backup, restoration onto replacement infrastructure, source comparison, measured recovery time and data-loss window | Operator and sponsor |
| Monitoring | Redacted logs/metrics, synthetic availability checks, tested alert delivery/escalation and retention | Operator |
| Capacity | Agreed workload/dataset/environment and measured latency/error/resource thresholds | Operator and sponsor |
| Upgrade | Versioned artifact, compatible migration rehearsal, backup and operator-executed rollback drill | Operator |
| Onboarding/support | Training, synthetic competency exercises, migration reconciliation, named incident contact and downtime procedure | Hospital sponsor and vendor |

Keep approval signatures and hospital-specific operational details in an
appropriately restricted customer record, not this public source repository.
Never attach patient records, passwords or production connection strings as CI
evidence. Record only redacted outcomes and identifiers of privately held evidence.

## Release decision

A release candidate is eligible for a live pilot only when every gate relevant to
its agreed package has evidence and an accountable acceptance decision. Record
unresolved defects explicitly; safety, authorization or data-loss defects block
launch. Later feature additions repeat the affected walkthroughs and regression
checks. This workbook is intentionally unsigned and has no completed approvals.
