---
title: Complete the hospital patient care lifecycle
status: in-progress
baseline_commit: deaad870638655e5b8a313ce3319e27e072777f9
context:
  - AGENTS.md
  - PRODUCT.md
  - DESIGN.md
  - shared/registration.ts
  - server/auth.ts
  - server/outpatient.ts
  - server/report-budget.ts
  - src/staff/api.ts
  - _bmad-output/implementation-artifacts/spec-product-completion.md
---

# Goal

Deliver usable persistent patient/care workflows for small hospitals, replacing
the remaining proposed-only core modules. Existing encounter/lab/pharmacy/billing
modules remain functional. Implement server/care.ts, shared/care.ts,
src/staff/CareWorkspace.tsx and care.css, migration016_care.sql and focused tests.
Root integrates routes/navigation, role lists, migration hashes and grants.
No app.ts/StaffApp.tsx/schema-manifest.ts/runtime-grants.ts edits. No other agents.

## Required workflows

1. Patient profile: name/contact/date of birth/sex/address/emergency contact,
   provisional/verified identity, allergies with entered status and revision.
   Preserve existing MRN, age and original registration. Audited correction
   requires reason and expected revision. Authorized admin duplicate resolution
   links a duplicate to a same-hospital canonical identity without deleting,
   renumbering or moving historical records; prevent cycles/self/cross-tenant
   resolution and conflicting active admissions. Longitudinal view displays the
   linked histories with clear original identities. Clinician/receptionist/admin
   have scoped appropriate access; nurses receive relevant clinical identity.
2. Appointments: patient, named clinician/service, facility, start/end timestamps,
   booked/arrived/cancelled/no-show status. Validate chronology and prevent active
   clinician overlap concurrently. Reschedule/cancel with attributable reasons;
   arrival creates or links exactly one existing outpatient check-in via durable
   request identity, never duplicates on retry. Show today's schedule and history.
3. Triage: patient/encounter, entered vitals with units, urgency selected by staff,
   symptoms and responsible nurse/clinician. Bounded plausible input constraints
   are validation, not diagnosis; never infer urgency or clinical decisions.
   Corrections append an amendment preserving original author/time/value.
4. Inpatient: configure wards/beds with active/inactive status; admit patient with
   responsible clinician, reason and original event time; transfer atomically;
   discharge with signed summary, disposition and follow-up. Prevent concurrent
   bed occupancy and multiple active admissions, cross-facility mistakes, closing
   an admission with unfinished administration tasks. Retain immutable movements.
5. Nursing: shift observations and append-only signed nursing notes linked to an
   admission; explicit amendments, author and recorded/event time. Clinician
   medication orders contain explicit product/drug text, entered dose/unit/route,
   scheduled time and stop/cancel instructions. Nurses record given/withheld/
   refused with reasons and actual event time; exactly one accountable outcome
   per administration task, auditable corrections. Do not supply calculated
   doses, automatic prescription decisions or silently mark medicines given.
6. Referral/follow-up: accountable outbound referral or scheduled follow-up,
   service/destination, reason, due date, assigned owner, pending/completed/
   cancelled status and amendment history. No external messages are sent.

## Shared constraints

New nurse role is added by root; allow nurse only to explicit nursing/triage
workflows, not finance/admin/prescribing. Admin may configure and supervise;
receptionist handles demographics/scheduling/admission registration only;
clinician authors clinical orders/discharge; auditors see governed histories.
Every entity belongs to a hospital, composite FKs enforce membership. API reads
are bounded/paginated and do not place clinical narrative in URL or logs.
Shared schemas are strict and bound text/time/quantities. Writes require current
actor after the hospital lock, expected revision where editable and unique
idempotency key with hash checking; replay rechecks authority before returning.
Transactions commit record + immutable actor/event audit + retry receipt together;
timeout returns safe retryable503. Reuse existing patterns instead of bypassing
auth or injecting complete production sessions. Build frontend with current calm
light/teal tokens; real loading/error/empty states and visible patient identity.
Expose sensible tabs/forms and working actions for all required workflows, with
clear validation, preserved pending key/payload and draft-departure confirmation.
Render text safely. Dates explicitly show timezone; no invented calendar.

## Acceptance/tests

Given a hospital and authorized roles, patient correction, appointment arrival,
triage, admit/transfer/order/administer/discharge and referral flows persist and
remain attributable. Given another hospital or reduced/revoked authority, all
protected operations reject without content or mutation. Concurrent booking/bed
or administration attempts commit one valid result. Identical retries reproduce
one result; changed payload/key and stale revision reject. Audit insertion
failure rolls back record and receipt. Merge preserves both source histories.
Add focused server tests plus a representative browser spec using existing
synthetic fixture conventions. Root wires scripts/CI. Run typecheck/focused
server tests once, fix concrete failures, send concise integration instructions,
test counts and remaining defects. Do not stop at APIs or stub screens.
