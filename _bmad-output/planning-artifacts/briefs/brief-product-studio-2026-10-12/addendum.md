# Hospital product discovery addendum

Date: 2026-10-12. Status: proposals and initial research; not an approved PRD.

## Deployment comparison

These are engineering tradeoffs, not vendor quotations. Obtain actual hosting,
hardware, power, connectivity, and support costs from candidate pilot sites.

| Option | Hospital experience | Advantages | Costs and failure modes | Initial assessment |
| --- | --- | --- | --- | --- |
| Hosted service in Ethiopia | Staff use a browser over the internet; we operate the service | Central upgrades, backups, monitoring, and remote support; less equipment at each hospital | Internet dependency; provider diligence, data-location verification, recovery and availability commitments | Preferred candidate when the hospital has adequate connectivity and a suitable domestic provider exists |
| Hospital-local server | Staff use browsers over the hospital LAN | Core local work can continue during an internet outage if power, server, and LAN remain available | Hardware/UPS costs, physical security, backup handling, patching, onsite support, and remote-support controls | Candidate where continuous operation without external connectivity is essential |
| Hybrid with local and hosted operation | Some work continues locally and data is exchanged with a hosted service | Potential resilience and centralized oversight | Synchronization, conflicting edits, identity matching, stale records, and duplicate transactions make this substantially harder | Defer full bidirectional operation until actual outage requirements justify it |

**Recommendation, not a selected architecture:** evaluate domestic hosted service
first. If representative customers require care workflows to continue during
internet loss, evaluate a hospital-local pilot. Choose one operating model for
the first release. Keep the application deployable without hard-coding a cloud
vendor, but do not promise simultaneous support for every model.

Local operation with an approved offsite backup is different from a hybrid
system that accepts edits in two places. A backup must not be described as live
failover. Browser caching by itself is not a safe offline clinical workflow.

A recurring subscription can include either operating model. Propose an
implementation/training fee plus a recurring software/support fee; treat local
hardware and onsite service separately. Pricing and service hours are undecided.
Define a commercial-dispute process that preserves safe access to existing care
records; do not implement a sudden subscription-expiry lockout of active care.

SaaS may use dedicated or shared customer resources. AWS documents silo, pooled,
and mixed models; this is useful architectural vocabulary, not an AWS hosting
recommendation for this product. Database-per-hospital versus shared-database
isolation remains an architecture decision with operational tradeoffs.
[AWS SaaS models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html).

## Ethiopian legal and integration discovery

The official Personal Data Protection Proclamation No. 1321/2024 classifies
health information as sensitive (Article 2(5)). Article 22 requires domestic
storage of locally collected personal data and prior authority approval for
sensitive-data transfers abroad. Articles 18–20 address cross-border transfers.
This is a preliminary reading, not a complete legal assessment. Have Ethiopian
counsel confirm application, current directives, registrations, contracts,
retention, breach procedures, and transfer approvals before live deployment.
[Official proclamation](https://justice.gov.et/wp-content/uploads/2025/04/seasiisia-seusiNse%C2%A1-1321-2016.pdf).

**Design proposal:** keep patient-bearing databases, attachments, backup copies,
and operational evidence in approved locations. Inventory analytics, support,
error tracking, notifications, and AI services before enabling them; a domestic
database does not settle every data-flow question. Use synthetic development data.

The Ministry of Health's resource catalogue lists an Ethiopian EHR system
standard, HMIS reporting guidance, a health-data access/sharing guideline, and
digital-health planning documents. The catalogue was located; the individual
documents have not yet been assessed. Retrieve applicable editions and confirm
private-facility obligations before turning these into requirements.
[MOH resources](https://dhpi.moh.gov.et/build/resources).

The MOH National Digital Health Exchange describes facility identifiers, shared
registries, and reporting connections. Investigate relevant facility identifiers,
report definitions, authorization, and interface specifications; discovery of a
national service does not mean our product has permission or an API contract to
connect. [MOH exchange](https://interop.moh.gov.et/).

Plan explicit import/export contracts and investigate HL7 FHIR where an actual
integration requires it. Do not equate a FHIR-shaped API with interoperability
certification or security. HL7 explicitly treats FHIR as a building block whose
implementation needs its own security controls.
[HL7 security guidance](https://hl7.org/fhir/security.html).

## Shared product, hospital configuration

**Proposed common product:** identity/access, patient directory, visit tracking,
records, billing, reports, audit, backup/restore, and installation/update tooling.

**Proposed configuration:** organization and branch structure, departments,
staff memberships, approved note templates, services and tariffs, receipt
branding, working hours, language/date display, and enabled modules. Configuration
changes need permissions, validation, version history, and a reviewable effect.
“Configurable” does not mean arbitrary customer code or untested clinical rules.

Validate Amharic/English and other language needs, Unicode name entry, patient
name structures, Ethiopian/Gregorian date display, unknown/estimated birth dates,
currency/rounding, receipts, tax treatment, payments, and reporting periods with
actual users. These are discovery candidates, not confirmed mandatory formats.

Separate vendor functions—customer onboarding, subscriptions, service health,
upgrades, and support—from hospital staff functions. A staff member serving two
hospitals needs explicit membership and clearly selected context for each.
Do not build a global patient search across independent customers by default.

## Security and safety evidence

**Proposed security baseline:** deny access by default; authorize every operation
against verified hospital membership and permissions; protect tenant boundaries
in records, files, queues, exports, caches, and backups. Require strong privileged
authentication, encryption with managed keys, audit history, and scoped,
time-limited support access. Test a user from Hospital A attempting Hospital B's
records, file links, exports, and background jobs. Dedicated databases do not
remove application authorization obligations.
[OWASP tenant isolation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html).

**Proposed clinical safety evidence:** rehearse patient identification, duplicate
handling, accountable record amendments, referral/result follow-up ownership,
and downtime/recovery with clinical staff. Use ONC SAFER as a safety reference,
not Ethiopian law or proof of certification.
[SAFER guides](https://healthit.gov/clinical-quality-and-safety/safer-guides/).

For the financial workflow, test retried submissions, concurrent payments,
invoice adjustments, refunds, receipt numbering, rounding, and cashier closing.
Define who can approve each exception and how the original record is retained.

## What the later modules really imply

| Module candidate | Questions before committing scope |
| --- | --- |
| Clinical outpatient records | Who authors, signs, corrects and reviews notes; which observations and histories are necessary; which current records remain authoritative? |
| Laboratory | Upload existing reports, integrate an existing lab system, or operate a laboratory module? A full module needs ordering, specimen tracking, validation and result follow-up. |
| Pharmacy | Stock only, dispensing, or prescribing? Clarify product/unit definitions, batches, expiry, returns and professional review. |
| Inpatient | Are beds, admission/transfer/discharge, nursing tasks, medication administration and charge capture required together? |
| Insurance | Which payers and contracts, eligibility checks, price lists, claims and reconciliation are needed? |
| Management | Which operational and statutory reports are required, by whom, on what schedule, and with which definitions? |

Bahmni is a useful established comparison for the breadth of a hospital product;
its lab documentation distinguishes orders, specimens and validated results.
This is a reference for discovery, not a decision to adopt or reproduce its code.
[Bahmni features](https://www.bahmni.org/feature-list/),
[laboratory scope](https://www.bahmni.org/laboratory/).

## Design-partner discovery plan

Interview 2–3 facilities from the selected market, including an owner/manager,
receptionist, cashier, clinician, nurse and whoever supports IT. Include lab or
pharmacy staff if those departments are essential to adoption. Seek anonymized
blank forms or fabricated examples, not real patient records.

1. Walk through a normal visit from arrival to payment, then the last difficult
   case: duplicate registration, cancelled service, correction or refund.
2. Establish current systems, daily visit/staff volumes, peak concurrency,
   printers, LAN, internet outages, power backup, and existing support arrangements.
3. Identify the first workflow worth paying to improve and what cannot stop
   during an outage. Separate indispensable features from later conveniences.
4. Establish languages/calendars, reporting, payments, integrations and migration
   needs. Identify procurement decision makers, budget, training time and support
   expectations without inventing a price or market-size estimate.
5. Agree a pilot owner, acceptance scenarios, baseline metrics, recovery targets,
   launch/rollback criteria and a feedback process.

Record differences across facilities. Select a representative common workflow;
do not treat the loudest customer's preferences as universal hospital practice.
