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

## Synthetic rehearsal reference

Use a dedicated fictional hospital with no unrelated concurrent work. Record a
report before and after the sequence using the same date range, including today
in Africa/Addis_Ababa. Differences below are fixture expectations, not targets for
hospital performance. All medicine names, instructions and quantities are test
inputs with no clinical meaning.

1. Register a fictional patient and open one visit. Save a clearly fictional note.
2. Create an approved-for-testing ETB 130 service and issue one invoice. Record
   ETB 50 cash and ETB 80 manual transfer. Replay a payment request through the
   automated verifier: it must retain the same receipt and amount.
3. Create a fictional product with base unit `unit`, one future-expiry batch, and
   receive 10 units. Add a fictional prescription and authorize 4 units explicitly.
   Supply 1, then 3. Confirm the first supply leaves the prescription pending and
   the second completes it. Stock must end at 6; no inferred dose or pack conversion.
4. Complete and review one fictional investigation. Close the visit after its
   outstanding clinical work is resolved.
5. Append one note amendment and one corrected result to the closed visit.
   Confirm originals remain visible, the correction creates fresh review work,
   and its assigned reviewer completes that review.
6. Run the report again. Reconcile against source invoices/receipts and inventory
   history, checking both the selected period and the current snapshot.

| Measure | Expected change after all steps |
| --- | --- |
| Visits opened / closed | +1 / +1 |
| Note amendments / result corrections | +1 / +1 |
| Recorded receipts / collections | +2 / ETB 130.00: cash 50.00, manual transfer 80.00 |
| Current outstanding invoice balance | No increase; fixture invoice is fully paid |
| Current active visits, investigations, prescriptions and corrected-result reviews | No increase; all fixture work is complete |
| New product period movements | Received 10, supplied 4, adjustment 0, net 6 |
| New product current stock | Total 6, available 6; excluded categories 0 |

Repeat with the relevant role accounts: clinicians receive activity/work counts,
cashiers finance, pharmacists inventory, and admins/auditors the combined report.
Reception and laboratory accounts have no aggregate-report access in this slice.
An empty selected period must not conceal older outstanding work. Changing pages
creates a fresh snapshot; changing dates or a failed request must not leave stale
results presented as current. Record disagreements with these definitions before
approving hospital use.

The packaged release verifier automates this transaction sequence with synthetic
records and checks previous saved records after restart. Its pass is engineering
evidence; the observed practitioner walkthrough and approval remain separate.

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
