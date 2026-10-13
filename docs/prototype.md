# Outpatient workflow prototype

This is a client-only synthetic-data demonstration for evaluating an outpatient
workflow. It is not ready for hospital operations or live patient information.
The scope is defined in
[`spec-outpatient-prototype.md`](../_bmad-output/implementation-artifacts/spec-outpatient-prototype.md).

## Walkthrough

1. Run `npm run dev` and open `http://127.0.0.1:5173`.
2. Register an invented patient. Name is required; age and contact are optional.
   Duplicate names require explicit confirmation that this is another person.
3. Check in from the directory. Check-in adds the consultation charge and opens
   the visit. A second active visit is blocked; the directory opens the current
   one instead.
4. Save a fictional consultation note, request a test and optionally add manually
   entered fictional prescription instructions.
5. In Diagnostics, collect the sample, enter a fictional result, release it and
   mark it reviewed. Released results cannot be edited. A request can be cancelled
   only before release. Cancelled tests cannot be requested again in that visit.
6. Fulfill or cancel pending prescriptions in Pharmacy.
7. In Billing, review the charges and record a demo settlement. No real payment
   occurs; repeated settlement of an already paid balance is blocked.
8. When all closure blockers are resolved, close the visit. Reload and find the
   read-only encounter through the directory's closed-visit links.

Workspaces show the same underlying patient and visit data. Diagnostics,
Pharmacy and Billing list visits with pending work in their department. Activity
shows the ordered event stream, with links back to encounters. A patient may have
multiple historical visits, but only one active encounter at a time.

## Decisions and boundaries

- React, TypeScript and Vite; Radix Dialog handles modal semantics and focus
  containment. Lucide icons have visible labels; DM Sans and Manrope are bundled
  locally. Desktop navigation becomes a wrapping mobile navigation bar. Tables
  scroll within labelled regions; patient-name buttons make opening a visit
  discoverable without horizontal scrolling.
- Typed domain commands make each accepted business mutation and append an
  activity event. Saved note revisions and released results persist. This is
  draft history, not signed clinical records or a legally sufficient audit.
- Monetary amounts use integer minor ETB. Consultation is 250 ETB; sample test
  prices are 180, 100 and 80 ETB. These invented prices are for demonstration.
  Each unique order has one charge. Settlement marks charges paid. Cancelling an
  unpaid request reverses its charge, including a new request added after an
  earlier settlement. Cancelling a paid request retains its paid charge and
  explicitly discloses that refunds are outside the demo. Pharmacy stock and
  medication pricing are deferred.
- Version-1 data in `hospital-workspace-demo-v1` is schema-validated on reading,
  including references, active-visit uniqueness, charge allocations and closure
  invariants. Invalid data is not automatically discarded. Reset requires a
  confirmation and replaces the entire demo dataset.
- Web Locks serialize writes between tabs; revision comparison rejects stale
  writes. Storage events also show a reload banner. A reset receives a new
  revision so older tabs cannot replace the reset records. Browsers without Web
  Locks receive an explicit error. Storage/quota failures keep the displayed
  dataset unchanged and explain the failure.
- Unsaved visit drafts survive dialog dismissal within the current page session;
  they do not survive a browser reload. Reset clears visit and registration drafts.
  Department lists open their matching visit tab. Optional contact is shown in
  the directory and visit details.
- Dates display in `Africa/Addis_Ababa` (EAT); timestamps are stored in UTC.
  Patient age is optional and constrained to whole years 0–120. Email is absent.
- The prototype has no backend, authentication, role authorization, hospital
  isolation, clinical recommendations, referrals, emergency triage, admission,
  stock management, insurance, external payments, signed records, result
  amendments, production backup or deployment. See
  [prototype-boundaries.md](prototype-boundaries.md).

## Verification

`npm run typecheck`, `npm test` and `npm run build` passed locally on 2026-10-13.
The unit suite covers registration, duplicates, forbidden order transitions,
closure blockers, payment retry, cancellation after earlier payment, historical
encounters, schema rejection, persistence round trips, stale revisions and
storage failures. All 12 desktop/mobile browser tests passed on the same date with
`npm run test:app`: desktop/mobile keyboard registration, the complete encounter
journey, focus return, filtering, workspace navigation, corruption recovery,
stale-tab recovery, reduced motion and axe checks in tested states.

The existing `.github/workflows/tooling.yml` is extended with application gates
instead of introducing a competing workflow. Existing tooling/security checks
remain. Browser reports and screenshots are under `artifacts/`; they are local
verification evidence, not a production readiness certification. The standalone
UI audit covers desktop/mobile initial states; browser tests cover additional
states. Manual screen-reader validation and hospital staff validation remain.

Detailed dated evidence and review resolutions: [prototype-verification.md](prototype-verification.md).
