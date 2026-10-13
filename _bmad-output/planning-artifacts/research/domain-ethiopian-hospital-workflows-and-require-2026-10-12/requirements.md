---
title: Candidate hospital product requirements
status: proposed-not-approved-for-clinical-use
updated: 2026-10-13
---

# Candidate requirements and validation scenarios

Read with [research.md](research.md). Source numbers below refer to that report.
Every requirement is a **design proposal**, even when motivated by observed
problems. Engineering safeguards are labelled **baseline**, not attributed to
an interview. These are PRD inputs; nothing below is implemented or clinically
validated. No specific deployment, stack or full module set is selected.

The [student project assessment](student-project-assessment.md) adds design
input dated 2026-10-13. R22–R24 are proposed engineering responses to that
document, not observed hospital requirements or approved scope additions.

## Proposed first prototype

Use synthetic patients to demonstrate an outpatient visit across reception,
nursing/clinical staff, laboratory handoff, pharmacy handoff and cashier roles.
Include a return for results and one outage-recovery scenario. Full laboratory,
pharmacy inventory and inpatient modules remain scope decisions; modelling a
handoff is not a claim of having implemented those departments.

| ID | Proposed behavior | Basis | Acceptance example |
| --- | --- | --- | --- |
| R01 | Isolate each hospital organization's records, searches, files, exports and background work. Branch membership is explicit. | Existing brief; baseline | A staff member cannot retrieve another customer's record by changing an identifier, search filter or attachment URL. |
| R02 | Search existing patients, assign stable facility identifiers and flag possible duplicates for authorized review. Never merge automatically on name alone. | [8] comparator; baseline | Two synthetic people with the same name remain distinct; a returning patient's new visit links to the existing identity. |
| R03 | Permit provisional identity and an audited urgent-care route without mandatory financial clearance; qualified staff define its use. | Proposed safety baseline | Authorized staff record an urgent encounter with incomplete demographics and later reconcile identity without losing history. |
| R04 | Keep department queues and arrival/start/completion times separate from visit status. | [2] | A patient can finish a consultation, wait for tests and return for review without creating an unrelated patient or silently closing the encounter. |
| R05 | Preserve clinician-authored notes and observations, units, author and timestamps; signed records receive amendments rather than silent replacement. | [4]; baseline | Correcting a signed entry retains its original content, reason and author. Clinical fields require clinician review. |
| R06 | Orders identify encounter, requester, destination and status; receiving teams can acknowledge them. Retries do not create duplicate work. | [4], [5]; baseline | After a network interruption, retrying one order yields one destination task and an honest pending/received state. |
| R07 | Link specimen identifiers and collection/rejection status to the ordered test and patient. | [3]; design inference | A rejected specimen remains visible and requests recollection; it is not marked as a completed test. |
| R08 | Version test definitions and report applicable units/reference ranges, narrative findings, release state and responsible professional. | [4] | A draft result is not shown as final; a revised catalog does not silently reinterpret an old report. |
| R09 | Correct released results with an audit trail and explicit clinician review task; retain external-result source/date. | [4]; baseline | A correction preserves the previous version and produces a new review task; an uploaded outside report is labelled external. |
| R10 | Separate prescription from dispensing, including unfulfilled or partially fulfilled requests. | [4], [7]; inference | Payment alone never marks a prescription dispensed; actual fulfillment and outstanding quantity remain distinct. |
| R11 | If inventory is in scope, track batch, expiry, location and stock movements, with accountable reversals. | [7]; baseline | A dispense consumes the chosen batch once; expired stock cannot be dispensed; concurrent attempts cannot oversell the final unit. |
| R12 | Separate charge, invoice, payment, receipt, refund and service fulfillment. Configure checkpoints and authorized exceptions. | [3], [7]; baseline | Payment before tests and settlement after care are separate supported configurations; a failed payment does not erase the order. |
| R13 | Reconcile cashier sessions and require authority/reasons for discounts, refunds and reversals. | [7]; baseline | A refund links to its original receipt and records approver; closing a shift shows expected, counted and discrepancy amounts. |
| R14 | Preserve referral and outside-service handoffs as pending/completed/declined with provenance. | [4]; inference | A service unavailable internally can remain pending externally, without being recorded as performed locally. |
| R15 | Provide a documented outage process and controlled paper-origin re-entry with occurrence time, entry time, author and reconciliation owner. | [5]; baseline | Re-entering a numbered downtime transaction twice is detected; recovery preserves when care occurred, not just when typing resumed. |
| R16 | Use individual accounts, least-privilege roles and auditable access; support access is explicitly authorized and time-limited. | Existing brief; baseline | A cashier cannot edit clinical notes; a support session leaves an attributable record and expires. |
| R17 | Encrypt transport, protect stored data/backups and secrets, redact telemetry, and test restoration for the chosen hosting design. | Existing brief; baseline | Restore synthetic hospital data into an isolated recovery environment and verify integrity and agreed recovery targets. |
| R18 | Onboard departmental owners, train by role and document primary/backup support responsibility. | [5], [6] | Each role completes its own synthetic task; support coverage survives the primary administrator's absence. |
| R19 | Report unfinished handoffs, waiting vs service duration, incomplete records and reconciliation differences. | [1], [2], [6] | A visit with a paid invoice and an unreviewed result remains visible as unfinished clinical work. |
| R20 | Define reporting exports against current facility/MOH definitions; distinguish manual export from tested integration. | [4], [6] | An agreed synthetic reporting period reconciles to source records; no DHIS2 integration claim exists until mappings and delivery are verified. |
| R21 | Configure names/identifiers, language, calendar display, currency, services and price versions without product forks. | User's reusable-product objective; unvalidated localization choices | Changing a tariff affects new charges while preserving old invoice values; historical dates remain unambiguous. |
| R22 | Separate patient registration from portal account creation. Support no email, shared contact details and explicit unknown/estimated demographic values without inventing precision. | Student assessment, pp.43–45, 50; proposed baseline | Register a child and an adult without email accounts; a shared guardian contact does not merge their records. Later portal enrollment links to a verified existing identity. |
| R23 | Deactivate staff/branch access without cascading deletion of clinical history or authorship. Apply a separately defined retention process to any later disposal. | Student assessment, pp.17, 52–53; proposed baseline | A departing doctor's access ends, including existing sessions, while prior notes retain their author and remain available to authorized successors. |
| R24 | Enforce organization membership, active permissions and approved care access on every record request. Historical treatment or a visibility flag alone cannot grant access. | Student assessment, pp.13, 38, 46–48; proposed baseline | Revoking a clinician's membership denies further reads and writes, including direct record and export requests; earlier care does not override revocation. |

These scenarios specify intent, not a complete test suite. Numeric recovery,
latency, concurrency and retention targets require workload and policy decisions.
Security baseline details must be traced to the project's release controls and
current Ethiopian obligations before live data is used.

## Walkthrough pack for requirements review

1. **Returning patient, same name as another patient:** receptionist finds the
   correct identity, opens a visit and preserves separate records (R02, R04).
2. **Consultation → test → review:** doctor orders; lab receives; cashier records
   clearance if required; specimen/result progress independently; doctor reviews
   the released result before closing the clinical task (R04–R09, R12).
3. **Correction after review:** authorized laboratory staff amend a result;
   original values remain, and a fresh review task reaches the clinician (R09).
4. **Partially fulfilled prescription:** pharmacy records available quantity and
   outstanding work; finance and stock reflect actual transactions (R10–R13).
5. **Unavailable internal service:** staff record the external handoff and later
   attach a sourced report, without claiming an internal service occurred (R14).
6. **Interrupted order and downtime paper work:** recover a failed connection,
   retry safely, reconcile a paper transaction and expose unresolved items
   (R06, R15, R18). Test power/LAN loss separately from internet loss.
7. **Two hospitals:** repeat searches, direct record requests, exports and file
   downloads using staff from each organization; deny every cross-customer path
   (R01, R16). Sharing a name does not create a shared patient record.
8. **Urgent arrival:** qualified staff exercise the approved urgent route;
   identity completion and financial handling remain auditable afterwards (R03).
9. **No patient account:** register a child using a guardian's contact and an
   unrelated adult without email; preserve separate identities (R02, R22).
10. **Staff departure:** deactivate a clinician with an active session; deny
    further access while preserving signed notes for authorized staff (R23, R24).

## Questions public evidence cannot settle

| Decision | Concrete review material | Eventual reviewer |
| --- | --- | --- |
| First sellable scope | Walkthroughs above plus a department coverage checklist | Owner/administrator and departmental leads |
| Payment timing, exemptions, refunds, credit and insurance | Two alternative payment sequences, sample invoices and reversal records | Finance lead and clinical lead |
| Clinical forms and result responsibility | Synthetic encounter, original/corrected result and pending-review screen | Clinician and diagnostic staff |
| Prescribing/dispensing and stock | Partial fulfillment, stock receipt and return scenarios | Pharmacist and storekeeper |
| Localization and identity | Sample names, identifiers, dates, printouts and duplicate candidates | Reception, records staff and local users |
| Hosting and support | Internet/power/LAN failure walkthrough and costed hosting options | Administrator and IT/support provider |
| Reports and compliance | Current forms, indicator definitions and requirement-to-control matrix | Records/reporting staff and relevant local specialists |
| Commercial value | Current-system comparison and measurable pilot outcomes | Purchasing decision-maker |

Public research lets us prepare these materials now. It does not establish the
answers or imply that the founder must already know a hospital. Recruitment can
follow a useful demo; no outreach is authorized or performed by this document.

## Before a live pilot

Agree department coverage and responsibilities; obtain clinical/operational
review; resolve current legal/data-location requirements; test permissions,
record corrections, financial integrity and restore/recovery; train actual
users; and define support and incident ownership. A synthetic prototype should
not be sold or represented as ready for live patient care.
