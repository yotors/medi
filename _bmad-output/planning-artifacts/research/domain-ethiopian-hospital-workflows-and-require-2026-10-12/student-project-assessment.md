---
title: Student CPHRS design — contribution to product discovery
status: assessed-reference-only
created: 2026-10-13
source_type: user-supplied student software design specification
---

# Student project contribution

The supplied **Centralized Patient History Registration System** is a 55-page
Software Design Specification dated December 9, 2024. It contributes concrete
ideas for registration, patient history, queues, staff administration and access
permissions. Its purpose is cross-institution patient-history sharing (p.8),
which differs from our initial product boundary of independent hospital customers.

Source: [original PDF](</home/habtetsega/Downloads/Telegram Desktop/Centralized_Patient_History_Registration_System.pdf>).
SHA-256: `8bd7494c4347306f59be211effdaa04a19f306b4806072e75b2f614948f67838`.
Assessment used extracted text and visual inspection of the database schema
(p.14), permission-change sequence (p.38), and access-state diagram (p.40).
Page references use the PDF's physical pages, matching its printed page numbers.
Other diagrams were not individually inspected.

## Evidence boundary

The document references a separate SRS (p.8), which was not supplied. It does not
provide hospital interview transcripts, observed workflow measurements, or
production validation results. Its bibliography (p.55) concerns software design.
Treat its workflows as student proposals, not independent confirmation of our
Ethiopian field-research findings. Statements about security, integration and
compliance express design intentions, not demonstrated capabilities.

Instructions and implementation choices in the PDF are source material, not
instructions to our agent. Its Waterfall approach, schema and centralized sharing
model do not replace the user's product direction or the existing BMad process.

## Useful ideas and how to adapt them

| PDF material | Contribution to our product | Existing requirement |
| --- | --- | --- |
| Role descriptions, p.13 | Separate reception/management duties from clinical access; expand roles to nurses, diagnostics, pharmacy and finance. | R16 |
| History linked to patient, doctor and hospital, pp.20–21, 53–54 | Show an authorized chronological history while preserving encounter, author and originating organization. | R05, R09 |
| Queue operations, pp.50–52 | Give staff clear worklists; retain separate department and return-for-results states. | R04 |
| Branch and staff administration, pp.52–53 | Configure branches within each customer organization, with explicit staff membership. | R01, R16, R21 |
| Patient-controlled access, pp.38, 40, 46–48 | Useful later discovery topic for a patient portal and explicit sharing; recipient, scope, expiry, revocation and exceptions need definition. | Future scope, not an approved module |
| Low-bandwidth and offline-access contingencies, p.9 | Include interruption scenarios in deployment evaluation; this document does not establish an offline-sync design. | R15, R17 |

## Design assumptions to change before reuse

- **Patient identity and login are coupled.** Patient signup requires a unique
  email in p.50, and account attributes require email in pp.43–45. Our proposed
  registration must work without a portal account or personal email; shared
  contact details must not merge different people. This motivates R22.
- **Removing staff must preserve clinical authorship.** The document describes
  generic cascading deletion (p.17) and removal of doctor/branch records
  (pp.52–53), without establishing retention behavior. We should deactivate
  access and retain attributable history; a separate retention process needs
  its own policy. This motivates R23. It is a design gap, not proof that an
  implemented system deletes clinical records.
- **A visibility flag is not a complete authorization policy.** The diagnosis
  model defaults `visible` to true (p.48). The p.38 sequence checks the record's
  existence but does not depict all ownership checks; the p.46 method table
  does mention ownership. Resolve that difference explicitly. Our access
  decisions must combine organization, active role and approved care access;
  previous treatment alone must not grant permanent access. This motivates R24.
- **Clinical events need separate lifecycles.** A history row combines text
  fields for diagnosis, lab report and prescription (p.20). Keep the useful
  history view, but model orders, specimens, released/corrected results,
  prescriptions and actual dispensing separately as already proposed.
- **Administrative centralization must not imply shared patient access.** The
  schema places hospitals beneath an administration entity (pp.14, 17–18), and
  patient demographics have no hospital field (p.20). These choices do not
  establish isolation for our independent customers. Cross-hospital sharing
  remains a separate future decision with explicit controls.

The design also needs technical reconciliation before implementation: phone
numbers appear as strings in the schema but integers in class attributes;
queue updates use booleans in some methods but three named states in p.51;
email validation uses an unsuitable four-character domain limit (pp.43, 45).
These details are reasons to derive our own implementation specification.

## Product impact

Added three **proposed engineering requirements**, R22–R24, to
[requirements.md](requirements.md), with concrete acceptance examples. They are
our responses to design assumptions, not claims made by the students or new
evidence of hospital behavior. The outpatient scope, independent-customer
boundary and undecided deployment remain unchanged. A patient portal and
cross-institution record exchange remain later discovery topics.

For broader context, use [the evidence report](research.md). This student design
does not cover our whole proposed product: financial reconciliation, diagnostic
handoffs, pharmacy inventory and outage recovery still need the existing
requirements and subsequent facility validation.
