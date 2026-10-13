---
title: Medi — commercial hospital management product
status: draft
created: 2026-10-13
updated: 2026-10-13
review_status: partial — clinical, commercial, and deployment decisions outstanding
---

# Medi product requirements

Medi is a reusable hospital management **web application** for small private hospitals and medical centers in Ethiopia. The product must support a hospital's staff, clinical handoffs, money, stock, records, and ongoing operation across multiple customer organizations. Desktop and mobile describe responsive browser layouts, not separate native applications.

**The product is not finished.** The implemented, tested outpatient slice is a development foundation using fictional patients. This document defines the proposed whole-product requirements and release boundaries; it does not grant approval to use live patient data or claim that the proposed features exist. No release date, capacity, availability commitment, regulatory compliance, or confirmed customer demand is established.

## 1. Purpose and evidence

This PRD gives the founder, implementers, and future hospital reviewers a common basis for decisions and subsequent UX, architecture, and delivery work. Functional requirements have stable FR identifiers; release stages distinguish a demonstration from a commercial service. Implementation mechanisms belong in [the addendum](addendum.md) and [deployment notes](../../../../docs/deployment.md).

Confirmed founder decisions: Ethiopia first; small private hospitals and medical centers; a product sold to multiple hospitals; secure and general rather than customized for one hospital; a calm, light workspace with teal accents; UI libraries are welcome; a web app with responsive layouts; local Docker development is authorized. The founder has not selected hosted, hospital-local, or hybrid deployment and wants notice when infrastructure decisions become necessary.

The [existing product brief](../../briefs/brief-product-studio-2026-10-12/brief.md), its [addendum](../../briefs/brief-product-studio-2026-10-12/addendum.md), and [public workflow research and candidate requirements](../../research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/requirements.md) are discovery inputs. R01–R24 are proposals based on public evidence, not hospital-approved requirements. The [student-project assessment](../../research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/student-project-assessment.md) treats the supplied PDF as a starting point. It does not establish a national patient identifier, cross-hospital data-sharing permission, a clinical operating procedure, or a production architecture.

No direct customer interviews or observed hospital sessions have been completed. The examples below are synthetic walkthrough scenarios to validate with practitioners. Existing implementation evidence is recorded in [staff workspace documentation](../../../../docs/staff-workspace.md) and [the completed outpatient slice specification](../../../implementation-artifacts/spec-connected-outpatient.md). Passing those checks establishes only that slice's stated behavior.

## 2. Product thesis and users

A hospital should be able to follow a patient through registration, care, investigations, medicines, charges, and follow-up without losing accountability at each handoff. Hospital administrators should configure their organization and operate the same maintained product as other customers, with separation of their records and access. Repeatedly handing off one outpatient visit is the current learning vehicle, not the limit of the product ambition.

The product must serve reception and records staff, nurses, clinicians, laboratory staff, pharmacists and storekeepers, cashiers, hospital managers, and authorized auditors. Deployment and support operators need operational visibility without unrestricted routine access to patient records. Each role and exception requires hospital review; the current development role matrix is provisional.

The first validation target is an outpatient service. **[ASSUMPTION A1]** A sellable outpatient package can be useful to some target medical centers before inpatient operations are complete. This is a proposed sequencing decision, not evidence of willingness to buy. A hospital needing admissions, wards, maternity, surgery, emergency services, or other unsupported functions cannot be told that the outpatient package replaces those operations.

### Synthetic walkthrough scenarios

- **UJ-1 — Returning patient, shared outpatient visit.** Hana is a fictional receptionist signed in to one hospital. She searches before registration, verifies identity, opens a visit, and hands it to the appropriate service. Fictional nurse Selam records triage; fictional clinician Dawit documents care and orders an investigation. The laboratory releases a result; Dawit acknowledges it before finishing the encounter. Each staff member sees their assigned work and the patient's identity. If identity is uncertain or two users edit concurrently, the workflow preserves the original records and requires resolution.
- **UJ-2 — Medicines and financial accountability.** Fictional pharmacist Meron receives an authorized prescription, checks available stock and applicable restrictions, and records the actual quantity supplied or an unfilled reason. Fictional cashier Abebe collects or allocates payment against an itemized invoice under hospital policy. A reloaded browser or duplicate submission cannot create a second dispense or payment. The patient's next action and any remaining clinical or financial work are distinct.
- **UJ-3 — Correct a historical mistake.** Dawit discovers an incorrect note after a visit is closed. An authorized amendment records the correction, author, time, and reason while retaining the original. A corrected laboratory result has explicit acknowledgement and escalation requirements; it never silently replaces a prior result.
- **UJ-4 — Operate a customer organization.** Fictional hospital administrator Rahel configures departments and permissions, disables a departing employee, reconciles a day's collections, and reviews a support incident. The employee's existing session loses access; records remain attributable to that employee. The operator restores a backup in an isolated exercise and demonstrates which records are present before anyone accepts recovery readiness.

These scenarios are inferred test scripts, not interview transcripts. **[ASSUMPTION A2]** The named departmental handoffs represent a useful validation sequence; the actual hospital's staffing, order, exceptions, and delegated authority remain to be confirmed.

## 3. Vocabulary and scope status

| Term | Meaning |
| --- | --- |
| Organization | The customer hospital or medical center that owns a separated set of operational records. |
| Facility | A physical service location of an organization; branch support is a proposed capability. |
| Patient record | Organization-scoped identity and longitudinal care information; it is not a national shared record. |
| Visit | A care encounter whose clinical and operational tasks have explicit states. |
| Order | A request for an investigation or medicine linked to a patient record and visit. |
| Result | An investigation outcome with authorship, release, correction, and review states. |
| Dispense | The actual supply of a medicine against an order; distinct from prescribing and payment. |
| Invoice | Itemized charges and adjustments with an auditable balance; distinct from proof of payment. |
| Amendment | An attributable correction preserving the original clinical record. |
| Audit event | Attributable evidence of a protected action, without copying clinical narratives into general logs. |
| Pilot | A bounded, supervised real-world release that has met its stated gates; it is not today's synthetic demonstration. |

**Implemented** means a bounded synthetic behavior exists; **partial** means a related mechanism exists but the requirement is not complete; **proposed** means no implementation or approval is claimed. A proposed requirement is a candidate for validation and delivery, not an automatic feature commitment in every customer package.

| Capability | Current status | Intended scope decision |
| --- | --- | --- |
| Registration, directory, check-in, visit history | Implemented synthetic baseline | Extend to validated identity, corrections, duplicates, and migration. |
| Staff login, hospital separation, role-filtered visits, durable writes | Implemented baseline | Complete lifecycle, permissions, recovery, and production security. |
| Notes, investigation handoffs, prescription handoffs, visit closure | Implemented synthetic baseline | Add validated clinical content, safety exceptions, and amendments. |
| Billing | Demo settlement only | Real itemized financial workflows are required before commercial financial use. |
| Laboratory | Synthetic orders/results only | Validate specimens, verification, corrections, critical findings, and turnaround. |
| Pharmacy | Synthetic fulfillment only | Real dispensing depends on inventory, quantities, batch/expiry, returns, and controls. |
| Configuration, onboarding, staff administration, reporting | Mostly proposed | Required for repeatable customer operation. |
| Appointments, triage, referral/follow-up | Proposed | Validate inclusion in the first customer package. |
| Inpatient, nursing, beds, discharge | Proposed expansion | Required before claiming inpatient hospital coverage. |
| Emergency, maternity, theatre, imaging, insurance | Proposed service-specific modules | Scope with relevant practitioners before implementation or sale. |
| Production hosting, monitoring, support, disaster recovery | Not established | Required gates for any real deployment. |

## 4. Functional requirements

### Organization configuration and staff operation

**FR-01 — Separated customer records (partial).** Every patient record, visit, order, financial record, stock movement, and administrative action belongs to an organization. Current authorized organization and facility membership, permissions, and approved care access govern access; prior treatment alone does not grant continuing access. Acceptance: a staff account in organization A cannot retrieve or change organization B's records by searching, guessing an identifier, exporting, or reusing a stale link; denials do not expose the other organization's clinical content. Provider support access follows FR-05.

**FR-02 — Configurable organization (proposed).** Authorized administrators maintain facilities, departments, service catalogs, prices, role assignments, and organization settings with effective dates where historical interpretation matters. Acceptance: changing a service price does not rewrite a previously issued invoice; disabling a department prevents new routing without destroying past visits. Configuration cannot disable mandatory audit or organization separation.

**FR-03 — Staff lifecycle (partial).** Administrators invite or provision named staff, assign least necessary permissions, suspend access, and complete recovery under a verified process. Acceptance: a suspended account cannot use an already issued session; role reductions apply to the next protected action; actions remain attributable after staff departure. Shared clinical accounts are not an acceptable customer workflow.

**FR-04 — Privileged access and session protection (partial).** Clinical, financial, administrative, and operator privileges have explicit boundaries, session behavior, and higher assurance for privileged actions. Acceptance: direct requests are denied when the user lacks permission even if a screen is manipulated; session expiry preserves only recoverable work allowed by the approved privacy policy; password recovery cannot be performed by knowing a public hospital code. MFA and recovery choices must be resolved before production sign-in is accepted.

**FR-05 — Controlled support operation (proposed).** Support staff diagnose system health without routine patient-content access. Exceptional access is explicitly authorized, bounded in time and scope, and audited. Acceptance: support records show who approved access, its purpose, start/end, and accessed organization; expiry prevents further use. Customer onboarding and offboarding revoke obsolete access and account for backups and exports.

### Patient identity, arrival, and clinical records

**FR-06 — Patient registration and correction (partial).** Staff search existing records, register minimum necessary identity data, and correct demographic errors with history. Acceptance: a suspected duplicate is surfaced without automatically merging; concurrent registrations are handled under the approved matching policy; uncertain identity is recorded explicitly. Registration does not require a patient email address or portal account; shared contacts and explicitly unknown or estimated values are supported under the approved identity rules. Required identifiers, guardians/minors, unknown patients, naming conventions, and matching rules are decision D03.

**FR-07 — Duplicate resolution and data import (proposed).** Authorized records staff reconcile duplicates and import existing data through preview, validation, and attributable reconciliation. Acceptance: a merge preserves the source identifiers and clinical provenance, does not lose orders or balances, and has a controlled correction process; rejected import rows are reported without silently truncating them. No import into a live organization occurs before mapping and reconciliation approval.

**FR-08 — Arrival, appointments, and queues (partial).** Staff manage walk-in visits and, if included in the package, appointments, cancellations, no-shows, service routing, and priority. Acceptance: repeated check-in does not create a duplicate active visit; waiting, in-service, and completed states are distinguishable; clinical urgency is not inferred from payment status. Appointment and priority rules require validation under D01/D03.

**FR-09 — Triage and clinical documentation (partial).** Authorized nurses and clinicians document the approved clinical dataset, including relevant observations, history, findings, assessment, and care plan with units and attribution. Acceptance: a draft is distinguishable from a signed entry; required-field validation follows an approved clinical template; conflicting updates do not silently overwrite a colleague's work. The current free-text consultation is not a validated clinical template. Clinical terminology, allergy handling, and safety fields require D03.

**FR-10 — Historical integrity and amendments (partial).** Signed or released clinical records retain their original content; authorized amendments explain what changed, why, and by whom. Acceptance: reopening or correcting a visit cannot erase an original signed entry; a historical view shows both the original and its amendments in order. Today's immutable closed visits satisfy preservation but do not provide an amendment workflow.

**FR-11 — Referral, follow-up, and visit completion (partial).** Staff record disposition, referrals, follow-up instructions, and outstanding tasks according to approved clinical policy. Acceptance: clinical completion, administrative closure, and financial balance are separately visible; an urgent transfer or unfinished result has an accountable owner and next action. Urgent care and transfer must have a clinically approved route without mandatory financial clearance, with accountable later reconciliation. Current synthetic balance/blocker rules require clinical review before they govern a real patient's progression.

### Investigations and results

**FR-12 — Investigation orders and specimens (partial).** Authorized staff order cataloged investigations, record collection and specimen identity where applicable, track rejection/recollection, and cancel with reason. Acceptance: a specimen-to-patient mismatch cannot proceed as an ordinary valid specimen; a rejected specimen remains visible with the reason and follow-up task. The receiving service acknowledges an order or exposes an unaccepted work item; retrying the same order does not create a second work item. Required identifiers and permissible override authority are approved before laboratory use.

**FR-13 — Results, verification, and correction (partial).** Laboratory staff enter results with relevant units/reference information; authorized reviewers verify and release according to the test workflow. Acceptance: unreleased results are distinct from released results; correction preserves the original and records a reason; an ordering clinician sees that a previously reviewed result changed. A result retains the test definition, units and reference information applicable when released; changing the catalog does not rewrite history. External results retain performing service and source provenance. Correcting a reviewed result creates a fresh clinician review task with an accountable owner. Current release and clinician review mechanisms do not establish the full verification policy.

**FR-14 — Critical findings and closed-loop communication (proposed).** Validated critical findings create an accountable notification, acknowledgement, and escalation workflow. Acceptance: an unacknowledged critical finding remains outstanding after visit closure or shift change; the audit shows who received and acknowledged it. Thresholds, channels, escalation times, and fallback procedures are clinical decisions, not developer defaults.

### Medicines and inventory

**FR-15 — Prescribing and dispensing (partial).** Authorized clinicians issue structured prescriptions under the approved formulary and workflow; pharmacy staff record actual dispensed quantities, partial fills, cancellations, substitutions where permitted, and reasons. Acceptance: prescribing does not automatically count as dispensing; duplicate submission cannot dispense twice; the remaining quantity is calculable. The current free-text prescription/fulfilled state is insufficient for real medication dispensing.

**FR-16 — Stock and procurement (proposed).** Storekeepers record receipts, transfers, batch/lot, expiry, adjustments, and stock counts for medicines and applicable consumables. Acceptance: each dispense links to stock movements; expired or quarantined stock cannot be supplied through an ordinary workflow; a stock count discrepancy requires a reason and authorized adjustment. Negative-stock, procurement approvals, and costing policies require D05.

**FR-17 — Returns, wastage, and reconciliation (proposed).** Authorized staff record returns, wastage, and recalls with links to the originating movement and appropriate financial effects. Acceptance: returning an item does not erase the original dispense; its disposition determines whether available stock increases; a physical-stock reconciliation can explain movements for a selected period. Controlled-item requirements require specialist review before those items are supported.

### Billing and financial control

**FR-18 — Itemized charges and invoices (proposed).** Authorized services create charges using organization-approved prices; cashiers produce itemized invoices with patient/visit links and a stable invoice identity. Acceptance: stored invoice lines retain the applicable price and adjustment history; a service cancellation produces a traceable financial action rather than silently deleting an issued charge. Tax, invoice, receipt, and numbering rules require qualified local review under D06.

**FR-19 — Payments, credits, refunds, and reversals (partial).** Cashiers record payment allocations and permitted credits/refunds with method, amount, reference, authority, and reason. Acceptance: a retried payment submission changes the balance once; concurrent payments cannot over-allocate without an explicit approved credit policy; a reversal preserves the original payment. Current demo settlement is not evidence of payment integration or real cash control.

**FR-20 — Collection reconciliation and responsibility (proposed).** Finance staff reconcile cashier shifts, payment methods, unpaid balances, adjustments, and exceptions. Acceptance: opening balance plus movements explains closing balance; every discrepancy can be traced to attributable entries; a cashier cannot grant themselves an otherwise restricted refund. Insurance, employers, or credit accounts require a separate approved payer workflow before sale.

### Hospital service modules

**FR-21 — Admission, beds, transfer, and discharge (proposed expansion).** Authorized staff manage admissions, bed occupancy, ward transfers, discharge, and linked charges when an inpatient package is enabled. Acceptance: two active admissions cannot occupy the same exclusive bed without an explicit validated exception; transfers preserve the clinical record and occupancy history; discharge distinguishes unresolved clinical work from financial administration. Admission types and exception rules require D01/D03.

**FR-22 — Nursing and inpatient care (proposed expansion).** The inpatient package includes validated nursing observations, care plans, handover, medication administration, and discharge instructions. Acceptance: scheduled medication administration is distinct from prescribing and dispensing; an omitted or late administration has an attributable record; shift handover identifies unresolved tasks. No inpatient claim is permitted with only a bed board and outpatient notes.

**FR-23 — Specialist service workflows (proposed expansion).** Emergency, maternity, theatre, imaging, and other specialist services receive module-specific validated workflows when selected for a customer package. Acceptance: each enabled module has its own scope, role map, safety exceptions, record set, and practitioner sign-off; unsupported modules are identified before a contract is accepted. This PRD names the coverage gap and does not invent specialist clinical protocols.

### Information, interoperability, and ongoing operation

**FR-24 — Reporting and audit review (partial).** Authorized staff obtain operational, financial, stock, and clinical service reports appropriate to their permissions and the selected package. Acceptance: report totals reconcile to the source transactions for a fixed period; exported records obey organization and role boundaries; patient record access and protected changes have an attributable audit trail. The initial operational report set includes unfinished work, waiting/service intervals, visit disposition, record corrections, cash reconciliation and stock discrepancies; approved reporting definitions govern counting and exclusions. Existing mutation audit is not proof of complete read/export auditing.

**FR-25 — Hospital reporting and integrations (proposed).** Approved exports or integrations use agreed versions, identifiers, units, error handling, and reconciliation. Acceptance: a rejected or duplicate delivery is visible and recoverable without silently duplicating source transactions; sample reports are checked by the receiving hospital authority. National reporting, payment, analyzer, insurance, and record-exchange integrations require individual contracts and validation; no existing connection is implied.

**FR-26 — Customer onboarding, upgrades, and exit (proposed).** An operator provisions an organization, verifies configuration and data migration, trains staff, applies a supported upgrade, and provides an authorized export on exit. Acceptance: onboarding can be repeated for a second organization without copying the first customer's patient records or secrets; an upgrade preserves records and has a rehearsed recovery path; export is documented and reconciled. Licensing or subscription changes must not erase records or make urgent care documentation inaccessible without an approved continuity policy.

**FR-27 — Downtime and reconciliation (proposed).** Each deployment has an agreed workflow for network, power, application, or database outage and controlled entry/reconciliation of work performed during downtime. Acceptance: the product communicates unavailable and uncertain write states; recovery distinguishes confirmed from unconfirmed work; reconciling downtime records preserves author, original event time, later entry time and the responsible reconciliation owner. Re-entry checks existing records and flags suspected duplicates for review rather than creating a second order, dispense or charge silently. Offline multi-device writes and synchronization are not currently supported or implicitly promised.

**FR-28 — Privacy, retention, and record requests (proposed).** Authorized processes handle purpose-limited access, consent or other applicable authority, patient record requests, approved retention, legal holds, and disposal. Acceptance: a record request is verified and audited; retention jobs respect applicable holds and produce reviewable results; backups and exports are included in the governance policy. Applicable obligations and lawful timelines are decisions for qualified Ethiopian review, not facts inferred from this PRD.

## 5. Cross-cutting quality and safety requirements

- **NFR-01 — Authorization evidence.** Every protected read, mutation, export, and administration path has positive and negative organization/role tests. Zero known cross-organization exposure or unresolved critical authorization defects is a release gate. The product's control assessment includes applicable OWASP ASVS controls with evidence; no certification is claimed.
- **NFR-02 — Durable, attributable transactions.** Concurrent edits, double submissions, process interruption, and network ambiguity cannot silently lose a confirmed write or duplicate a financial/stock action. Release tests include retries with the same operation identity, changed-payload rejection, stale edits, and restart/recovery cases. Record and audit changes commit consistently.
- **NFR-03 — Data protection.** Production uses protected transport, managed secrets, least-privileged access, protected backups, and redacted operational logs. Acceptance includes inspecting sample logs for patient narratives/credentials, restoring with separately controlled credentials, and demonstrating revocation. At-rest protection and key custody depend on deployment D02/D07.
- **NFR-04 — Usability and accessibility.** The calm light/teal design supports clear patient identity, keyboard completion of critical workflows, visible focus, readable errors, and usable desktop/mobile layouts without accidental horizontal page overflow. Proposed accessibility target is WCAG 2.2 AA for selected critical workflows, subject to validation; automated scans alone do not establish conformance. **[ASSUMPTION A3]** Desktop remains the principal staffed workstation, with responsive mobile support rather than a native application.
- **NFR-05 — Localization.** Dates, times, patient names, phone/address fields, printed forms, money, and language are configurable or explicitly bounded for the selected market. Date entry/display never silently changes clinical chronology. ETB is the initial billing currency candidate; required languages, Ethiopian/Gregorian calendar behavior, time conventions, and print layouts require D04.
- **NFR-06 — Measured performance and capacity.** Before a pilot, agree dataset size, roles, concurrent workload, network conditions, latency/error thresholds, and growth assumptions; test those conditions and record results. Current smoke tests establish no supported hospital count or concurrent-user capacity. Numeric acceptance thresholds are owned by D08 and cannot be replaced with an unmeasured scalability claim.
- **NFR-07 — Recovery and support.** Before live use, approve backup frequency, recoverable data-loss window, recovery-time target, support coverage, and ownership; rehearse the complete application/database/file recovery and failover or downtime procedure as applicable. Local logical restore evidence is useful but is not a production disaster-recovery result.
- **NFR-08 — Observable and maintainable releases.** A production release has health checks, redacted telemetry, actionable alerts, ownership, migration verification, rollback/recovery instructions, dependency/security maintenance, and incident records. Acceptance includes an alert drill, a failed-upgrade exercise, and an identified responder. Availability commitments are not made before operations and costs are measured.

Clinical decision support, dose recommendations, automated diagnoses, and automatic treatment decisions are not part of the current scope. Safety-relevant validation and thresholds must come from qualified practitioners and approved sources; developer inference cannot substitute for them.

## 6. Release stages and definition of completion

**[ASSUMPTION A4]** The stages below are a proposed delivery sequence. They preserve the full hospital ambition while preventing unfinished modules from being sold as complete.

| Stage | Purpose and included work | Exit evidence |
| --- | --- | --- |
| D0 — Implemented foundation | Synthetic registration and shared outpatient handoffs, local database, sessions, isolation baseline, role views, audit, tests and local restore checks. | Existing slice evidence; clearly labeled synthetic data. Completed slice does not complete this PRD. |
| D1 — Product foundation and validated workflow | Organization/staff lifecycle, configuration, clinical dataset and amendments, deployable operation design; practitioner walkthroughs of normal and exceptional paths. | Approved role and workflow decisions, prioritized package backlog, scenario results and unresolved-risk owners. Synthetic development can proceed while recruitment is pending. |
| P1 — Controlled outpatient pilot | Selected outpatient capabilities with real billing and pharmacy/lab coverage appropriate to the facility; security, legal, training, support and recovery gates met. | Named partner and responsible clinical/operational reviewers; signed scope; no unresolved pilot blockers; approved data authority/location; restore and downtime drills; measured workload; monitored acceptance and rollback/exit plan. |
| C1 — Commercial outpatient package | Repeatable onboarding, configuration, commercial/support terms, invoicing/stock/reporting and upgrade/exit operations proven for the chosen package. | Pilot issues resolved; two-organization isolation and repeatable onboarding demonstrated; customer scope clearly identifies unsupported hospital services; support and operating cost evidence reviewed. This is not a claim that two customers already exist. |
| H1 — Hospital service coverage | Inpatient/nursing and whichever specialist modules target customers require, delivered in additional validated slices. | Service-specific clinical acceptance plus the same security, financial, operational and recovery gates. Hospital-wide coverage is claimed only for the modules actually delivered and contracted; a module required by a pilot facility must be delivered before that pilot, even if this table places it later. |

A stage exits on evidence, not on completing screens or reaching a calendar date. Feature flags, module packaging, or phased rollout cannot substitute for a missing safety-critical workflow in the service being used. No real-patient pilot is authorized by the present development request.

## 7. Outcomes and measurement

No baseline or customer target has been measured. The following are proposed measures; the founder and pilot hospital set target values before a pilot rather than inheriting invented percentages. D08 owns the measurement plan and D01 owns workflow acceptance.

| Measure | Definition and evidence | Counter-measure |
| --- | --- | --- |
| SM-01 — Completed handoffs | Visits whose required handoffs reach an attributable, reconciled outcome; segmented by service and exception. Validates FR-08–FR-15. | Missed/incorrect actions and unresolved tasks; faster closure must not hide unfinished care. |
| SM-02 — Identity quality | Confirmed duplicate and wrong-patient corrections per reviewed registrations, with review denominator. Validates FR-06/07. | Inappropriate refusal/delay to register patients without preferred identifiers. |
| SM-03 — Financial and stock reconciliation | Unexplained discrepancies by amount, quantity and age; reconciled sample invoices, shifts, and stock movements. Validates FR-16–FR-20. | Care delays caused by billing gates and work performed outside the system. |
| SM-04 — Operational recoverability | Observed recovery time and missing/incorrect records during rehearsed failures, compared with the approved recovery objectives. Validates FR-26/27 and NFR-07. | Restore testing that disrupts real services or exposes records. |
| SM-05 — Staff task success | Observed completion, errors, assistance and abandonment in representative staff scenarios and accessibility checks. Validates UJ-1–UJ-4. | Extra clerical burden, hidden paper workarounds, and unsafe shortcuts. |

Deterministic release invariants are separate from business metrics: zero known cross-organization authorization defects; no duplicate charge/dispense from a tested retry; original clinical records preserved after amendment; exported/reported financial totals reconcile in acceptance fixtures. These are test expectations, not observed production guarantees.

## 8. Open decisions, owners, and triggers

Roles below are accountability slots, not claims that these people have been hired or recruited. The founder owns recruitment and assigning a named decision-maker. Unassigned clinical, legal, or operational ownership blocks the relevant real-world release, not useful synthetic development.

| ID | Decision and currently missing evidence | Owner | Resolve by / trigger |
| --- | --- | --- | --- |
| D01 | First sellable package, facility services, pilot partner, excluded modules and acceptance authority. Outpatient-first usefulness is unvalidated. | Founder with hospital management and clinical lead | Before fixing a pilot backlog, promising customer scope, or setting a sales date. |
| D02 | Hosted, hospital-local, or hybrid deployment; connectivity/power constraints, data location, operator responsibilities, budget. | Founder with technical lead, prospective hospital and qualified local adviser | Before choosing paid hosting, creating an external patient-data environment, or signing installation/support commitments. |
| D03 | Clinical dataset, identity rules, triage/urgency, medication workflow, amendments, result escalation, closure and emergency exceptions. | Recruited clinical, nursing, laboratory, pharmacy and records leads | Before implementing safety-critical rules as production behavior or using real patient data. |
| D04 | Languages, date/calendar/time conventions, printers, labels, scanners and supported devices. | Founder with representative hospital staff | Before finalizing forms/printing and pilot procurement. |
| D05 | Formulary, stock units, batch/expiry, substitutions, returns, procurement, costing and controlled items. | Hospital pharmacy/store lead with finance lead | Before real dispensing or inventory migration. |
| D06 | Tariffs, invoice/receipt rules, adjustments/refunds, tax/accounting requirements, cash control and payer workflows. | Hospital finance lead with qualified local accounting/legal advisers | Before collecting or reporting real money; before claiming financial compliance. |
| D07 | Applicable privacy/healthcare obligations, contractual responsibilities, retention, access requests, support access, backups and keys. | Founder with qualified Ethiopian counsel/privacy adviser and hospital representative | Before choosing production data services, importing real records, or executing customer data terms. |
| D08 | Workload, performance thresholds, availability/support coverage, recovery objectives, incident response and costs. | Technical/operations lead with founder and pilot hospital | Before capacity claims, operational commitments, and pilot readiness sign-off. |
| D09 | Integration priorities and supported versions: reporting, payments, analyzers, insurance and record exchange. | Founder with hospital owner of each integration and technical lead | Before scheduling an integration or representing it in a sales contract. |
| D10 | License/subscription model, pricing, onboarding/training, updates, support, contract and exit terms. | Founder with commercial/legal/operations advisers | Before a commercial proposal or recurring hosting commitment. |

Decisions D01–D03 and D05–D08 are phase blockers for the relevant real-patient pilot. They do not authorize broad irreversible architecture assumptions now. Proposed platform work should expose choices and maintain testable isolation, migrations and exportability while decisions are gathered.

## 9. Assumptions and exclusions

- **A1:** An outpatient commercial package is a useful initial offer for some target medical centers; validate before sales scope is set.
- **A2:** The synthetic departmental sequence is a useful discovery script; validate actual hospital roles, order and exceptions.
- **A3:** Desktop is the primary staffed workstation with mobile browser support; confirm actual devices and workload.
- **A4:** Foundation → outpatient pilot → repeatable outpatient package → hospital service modules is the delivery sequence; founder and partner review it before commitments.

The current slice does not include national cross-hospital identity or shared patient records, insurance adjudication, full accounting/payroll, medical-device control, automated clinical decisions, native mobile applications, or offline synchronization. Some may become separately scoped integrations or modules; none is implied by “hospital management system.” Patient portals and messaging require their own privacy, consent, support and communication design before inclusion.

This draft can guide reversible planning and synthetic implementation. It remains **partial**, with unresolved clinical and commercial scope explicitly visible. A subsequent approval records which requirements and release package are accepted; it must not relabel every proposed feature as already implemented.
