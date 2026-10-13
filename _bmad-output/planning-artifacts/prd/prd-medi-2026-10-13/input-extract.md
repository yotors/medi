# PRD source extract — 2026-10-13

Read only the requested seven source files under `/home/habtetsega/Desktop/mpx/product-studio`. This is document extraction, not new implementation verification or legal research.

## Confirmed direction and status boundaries

- Brief confirms a reusable commercial product for multiple independent small private hospitals and medical centers in Ethiopia; protect patient information and adapt through configuration. Founder needs requirements discovery support and has no hospital contacts. UI libraries are acceptable.
- Independent hospital customers are the working boundary; branch membership is explicit. No default global patient search or cross-hospital sharing. Vendor administration does not imply unrestricted clinical access.
- PRODUCT.md records the user's instruction to start building and delegated implementation choice: React/TypeScript/Vite/Radix frontend plus Fastify/TypeScript/PostgreSQL staff workspace. This reversible prototype choice supersedes the earlier brief's entirely undecided stack, without approving production architecture.
- Product name, commercial terms, production hosting, local languages/calendars and validated clinical scope remain open. Outpatient-first and departmental handoffs are research-informed proposals; no facility has approved the workflow. Synthetic development data only.

## Existing scope documented as implemented

- `/`: browser-persisted outpatient simulation. `/staff`: separate authenticated PostgreSQL outpatient workspace; no record import between them.
- Staff: hospital-scoped directory/search, MRN registration with duplicate-name confirmation and optional age/contact, check-in, notes, diagnostic order/specimen/release/review/cancel steps, prescription fulfillment/cancellation, full demonstration settlement and closed visit history. No patient email/account requirement. Patient editing, merging/deletion and staff-management UI absent.
- Preliminary receptionist, clinician, lab, pharmacist, cashier, auditor and admin permissions; server omits restricted sections and checks commands. All roles currently see directory/summary/balances/blockers; admin clinical rights and this broad read policy require validation.
- Closure currently requires a note, reviewed/cancelled tests, no pending prescriptions and zero outstanding balance. Released results and closed visits cannot be rewritten. These are prototype rules, not an approved emergency-care policy or full amendment implementation.
- Revision conflicts, transactional commands/audit/idempotency and explicit retry preserve consistency; drafts/retry keys are memory-only and can be lost when leaving/reloading. Secure session foundations, active-user checks, CSRF/origin enforcement and session-derived organization predicates are documented, not a production security certification.
- Dedicated local PostgreSQL persistence and isolated logical restore comparison are documented. CI checks and test commands are listed in staff-workspace.md, but this extraction did not execute or independently verify them.
- Invented ETB tariffs and demonstration settlements; no real payments, medication catalogue/dosing, inventory, insurance, live clinical use or production deployment. MFA, mature lifecycle policy, production DB privileges, durable security/access audit, offsite encrypted backup, incident operations and full ASVS assessment remain needed.

## Proposed requirement groups (all R01–R24 remain provisional)

| Group | IDs | Required intent |
| --- | --- | --- |
| Organization/access/lifecycle | R01, R16, R23, R24 | Isolate records/files/exports/background work; individual least-privilege accounts and temporary authorized support; deactivate without erasing authorship; enforce current membership/permissions/approved care access on each request. |
| Identity/accessibility | R02, R03, R22 | Stable facility identity and reviewed duplicates; audited provisional identity and urgent route without mandatory financial clearance; registration independent of portal/email, shared contacts and explicit unknown/estimated values. |
| Encounter and accountable clinical work | R04, R05, R14 | Separate departmental queues from visit lifecycle; preserve authored observations and signed-note amendments; source and track external referrals/services. |
| Diagnostics | R06–R09 | Acknowledged idempotent orders; patient/order-linked specimen collection/rejection; versioned test definitions/units/ranges/release responsibility; corrected results with preserved versions and fresh clinician review, plus external provenance. |
| Pharmacy | R10, R11 | Separate prescribing and partial/full fulfillment; batch/expiry/location/movement/reversal safeguards only if inventory scope selected. |
| Finance | R12, R13 | Distinguish charges/invoices/payments/receipts/refunds/fulfillment; configured checkpoints/exceptions; accountable approvals and cashier reconciliation. |
| Continuity and rollout | R15, R17, R18 | Controlled outage paper re-entry with occurrence/entry times and reconciliation ownership; transport/storage/backup protection and tested restore; role training and primary/backup support responsibility. |
| Reporting and configuration | R19–R21 | Unfinished work/wait/service/record/reconciliation reporting; agreed current reporting definitions and honest export-versus-integration claims; versioned localization, service/tariff and organization configuration without forks. |

R11 is expressly conditional. Full laboratory operations, inventory, inpatient, insurance, patient portal and integrations are scope decisions. A handoff demonstration is not departmental implementation. Clinical decision support, prescribing automation, ICU, theatre and medication administration are not first-release promises. Numeric performance, concurrency, retention and recovery targets require policy/workload decisions; do not invent measured targets.

## Evidence limits

- research.md reports eleven original Ethiopian studies reviewed in digests, with evidence from limited private facilities, mixed/public samples and older fieldwork. Four private Bahir Dar EMR adopters surveyed in 2023 do not establish national/current adoption or product demand. Historical public pathways support scenarios rather than universal private-facility workflows.
- No project staff interviews/outreach, real patient collection, successful video-transcript inspection or watched demo videos. Published researcher interviews must not be described as our interviews. No willingness-to-pay, switching case, procurement evidence or validated language/calendar/reporting obligations.
- Public research supports a synthetic prototype and later role walkthroughs; clinical/operational validation remains a live-pilot prerequisite. The student's design is a separate proposal source.
- EHR standard listing was found but full document/current edition/enforcement were not verified. Existing addendum offers a preliminary reading of Proclamation 1321/2024 and proposed data-location controls, not current counsel-confirmed compliance. MOH catalogue/exchange discovery is not assessed requirements or API authorization. No certification, ASVS completion or interoperability claim.

## Deployment decisions outstanding

- Evaluate domestic hosted service first where suitable connectivity/provider exists; hospital-local candidate where core operation through internet loss is necessary. Recommendation only. Select one initial operating model after power/LAN/internet, support and cost evidence.
- Full bidirectional hybrid deferred absent demonstrated need. Offsite backup is not live failover; browser cache is not safe offline clinical operation. Subscription pricing does not select hosting.
- Decide dedicated/shared resources and DB isolation, approved data flows/locations including backup/support/telemetry/AI, provider diligence, key management, recovery/availability objectives, production accounts, patch/update/rollback and support ownership.
- Confirm applicable Ethiopian obligations/current directives with appropriate local expertise before live deployment. Commercial-dispute handling should preserve safe access to existing care records; avoid abrupt active-care subscription lockout.

## Student document treatment

- Supplied 55-page Centralized Patient History Registration System SDS, dated 2024-12-09; assessment inspected extracted text and selected diagrams only (schema p14, permission sequence p38, access-state p40). Separate SRS was not supplied. No hospital interview transcripts, workflow measurements or production validation.
- Reuse ideas for roles, authored chronological history, queues, branches and interruption scenarios. Do not adopt its Waterfall process, centralized cross-institution sharing or schema as instructions/product decisions.
- R22–R24 are our proposed responses: decouple identity from email/login; deactivate access while retaining authorship; combine active membership/permission/care access rather than visibility flags or historical treatment. Deletion behavior is an identified design gap, not proof of an implemented system deleting history.
- Patient portal/access sharing remains future discovery with explicit recipient/scope/expiry/revocation/exception controls. Student source does not establish offline synchronization or cover financial reconciliation, complete departmental handoffs/inventory or recovery requirements.

Sources: `briefs/brief-product-studio-2026-10-12/{brief.md,addendum.md}` and `research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/{requirements.md,student-project-assessment.md,research.md}` beneath `_bmad-output/planning-artifacts`; root `PRODUCT.md`; `docs/staff-workspace.md`.
