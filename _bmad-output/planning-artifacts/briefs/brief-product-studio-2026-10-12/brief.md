---
title: Hospital management product for Ethiopia
status: draft
created: 2026-10-12
updated: 2026-10-12
---

# Product brief: Hospital management platform

## Confirmed direction

Build a reusable commercial product for **small private hospitals and medical
centers in Ethiopia**, sold to multiple independent customers. It must protect
patient information and adapt to different hospitals through configuration.
The founder needs support discovering requirements. UI component libraries are
welcome. The product name, commercial terms, clinical scope, implementation
stack, and deployment model are undecided.

This is an initial discovery draft, not approved implementation requirements.
Statements marked **proposal** or **hypothesis** need validation with customers.

## Problem and value hypothesis

**Hypothesis:** target facilities would pay for reliable coordination between
registration, clinical staff, billing, and management, with less duplicate entry
and clearer accountability. Actual pain, current systems, willingness to pay,
and the reason to choose this product over alternatives are not yet established.

**Proposal:** deliver an understandable workflow from patient arrival to a
completed visit and reconciled payment, with implementation support, training,
and dependable maintenance. Prove value in a limited pilot before expanding.

## People and product boundaries

The likely buyer is a hospital owner or administrator; likely users include
receptionists, nurses, clinicians, cashiers, managers, and authorized support
staff. Validate their responsibilities and approval powers in interviews.

A hospital organization is the proposed customer boundary; branches belong to
that organization. Independent customers must not share patient records by
default. Any future referral or exchange feature requires an explicit sharing
workflow. Subscription administration must be separated from patient care and
must not grant the vendor unrestricted patient-record access.

## Proposed first useful release

Start with an **outpatient workflow within the target hospitals**, not a claim
to replace every inpatient and specialist system:

1. Configure the hospital, branches, departments, service prices, and staff access.
2. Search/register a patient, assign identifiers, and manage possible duplicates.
3. Book or record a walk-in visit, check in, and track the queue and visit status.
4. Record a clinician-authored encounter summary and selected observations if
   clinical partners validate that scope; preserve authorship and corrections.
5. Model diagnostic orders/results and pharmacy handoffs, including a return to
   the clinician for result review. Full departmental implementations remain
   scope decisions; validate who receives, completes and reviews each task.
6. Create an itemized invoice, record payments/refunds, issue receipts, and close
   the cashier's day with an auditable reconciliation.
7. Produce agreed operational reports, controlled exports, and audit history.

The development demo uses synthetic data. Before a live pilot, specify patient
identification, permissions, correction rules, outage procedures, and recovery
with the hospital team. A secure administrative pilot is an alternative if the
clinical workflow cannot yet be validated.

**Scope decisions:** full laboratory operations, dispensing and pharmacy stock, admission/bed
management/discharge, insurer workflows, patient portal, and external reporting.
Selection depends on what customers need to buy. Prescribing automation,
clinical decision support, ICU, theatre, and medication administration are not
promised for the first release.

## Deployment and business model

Compare hosted service, hospital-local installation, and hybrid deployment in
the [discovery addendum](addendum.md). Recurring subscription pricing does not
determine where servers or databases reside. Prefer one maintained codebase
and versioned configuration; avoid a separate product fork for every hospital.

No hosting choice is approved. Patient-data location, internet/power conditions,
local support capability, infrastructure budget, and Ethiopian requirements
must inform that decision. A hospital-local installation does not automatically
make the system secure or eliminate the need for backup and maintenance.

## Success measures to agree with pilot partners

- Complete the agreed patient-to-receipt workflow with representative staff.
- Measure registration/checkout time and reconciliation discrepancies against
  the hospital's baseline; agree targets before implementation.
- Demonstrate denied cross-hospital access, role restrictions, and accountable
  patient-record access/corrections.
- Restore a hospital backup and rehearse downtime recovery within agreed limits.
- Onboard a second independent hospital using configuration, without forking code.
- Establish willingness to pay, implementation effort, and sustainable support cost.

## Next discovery decisions

The founder has no hospital contacts. Start with the completed public-evidence
[workflow research](../../research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/research.md)
and its proposed requirements to prepare synthetic role walkthroughs. Published
studies support discovery; they do not validate private-market demand. Later
recruit 2–3 representative facilities to review workflows and, if suitable,
participate as design partners. This validates a reusable product; it does not
turn it into a bespoke system for one hospital. Establish essential departments,
clinical scope, languages/calendars, billing methods, outages, integrations,
budget, and applicable regulatory obligations before finalizing the PRD.
