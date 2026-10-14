# Staff outpatient workspace

The `/staff` route provides an authenticated PostgreSQL patient directory and
connected outpatient workflow. The original `/` outpatient walkthrough remains a separate browser
simulation; no records are imported between them. Use fictional details only.

## Run locally

```sh
npm ci --ignore-scripts
npm run db:local
npm run db:migrate
mkdir -p .local
chmod 700 .local
npm run setup:staff -- staff --hospital-code demo \
  --hospital-name 'Demo Medical Center' --username reception \
  --display-name 'Demo Reception' --role receptionist \
  --password-file "$PWD/.local/reception-password.txt"
STAFF_MFA_POLICY=synthetic npm run dev:api
# In another terminal:
npm run dev
```

Open `http://127.0.0.1:5173/staff`. For the account already provisioned on this
workstation, hospital code is `demo` and username is `reception`. Open the ignored
`.local/reception-password.txt` file locally to retrieve its generated password.
No password appears in documentation or application source. Existing accounts
are never overwritten by provisioning; skip that command when already created.

The command above explicitly permits password-only access for never-enrolled
fictional development accounts. Production rejects this policy. Previously
enrolled accounts still require MFA, including during recovery. For local MFA
testing, configure a private keyring and use the required policy described in
[staff authenticator sign-in](staff-mfa.md). The built HTTPS release always
requires MFA; its verifier credentials are separate synthetic test fixtures.

`db:local` creates an ignored mode600 `.env` only when absent, starts the dedicated
`hospital-product-studio` Compose project and waits for PostgreSQL. Its named
volume survives ordinary stop/restart. The database listens only on
127.0.0.1:15432; API only on 127.0.0.1:3100. Vite proxies same-origin `/api` requests.
Use 127.0.0.1 in the browser, matching `APP_ORIGIN`. `docker compose stop` stops this
project's database without deleting the volume. Do not remove the volume to
restart the app.

## Staff access and registration

The provisioning CLI requires explicit hospital/account fields and a private,
ignored password-file path. It generates a random password when that file does
not exist. For another hospital use another hospital code. Accounts cannot select
another hospital after authentication. Roles use the preliminary permissions below. Hospital administrators can manage accounts in Staff administration.

A saved registration receives a hospital-scoped `MRN-` number. Name is required;
age and contact are optional. Duplicate normalized names require confirmation
that a separate person is intended. This is a duplicate warning, not patient
identity verification. Search matches name, record number and contact, with 25
records per page. Unknown request fields are rejected.

Registration locks the hospital counter, creates the patient, retry receipt and
attributable audit event in one transaction. An identical idempotency key/body
returns the original patient; changed details with that key fail. An uncertain
browser response preserves the draft and key in memory and offers retry. Reload
loses unsaved drafts and the pending key; check the directory before registering
again. Patient edits, merges and deletion are not supported. Check-in and outpatient
records are persisted separately from the original browser walkthrough.

## Security implementation and limits

| Area | Implemented evidence | Still needed before live use |
| --- | --- | --- |
| Authentication | Salted, versioned scrypt hashes; generic login errors; persistent bounded login attempts; required production MFA and private recovery verified ([matrix](staff-mfa-verification.md)) | Lifecycle policy and hospital onboarding validation |
| Session handling | Random opaque cookie; hashed token in DB; HttpOnly/SameSite Strict; 8h absolute/30-minute idle limits; family logout and inactive-user checks under MFA review | Final session-race review, hospital policy validation and managed transport |
| Request integrity | Exact Origin on mutations and session CSRF header; strict validation/body limit | Broader ASVS review and external assessment |
| Hospital boundary | Session-derived hospital predicates; no client-selected hospital; composite foreign keys | Production DB privileges, defense-in-depth/RLS evaluation, validated clinical role matrix |
| Integrity and audit | Transactional registration and visit commands/audit/idempotency; author and exact visit-subject IDs | Tamper-resistant audit storage, access/security events and retention |
| Data persistence | PostgreSQL migrations, local volume, isolated backup restoration with counts/content digests | Off-site encrypted backups, migration release strategy and disaster recovery |
| Sensitive output | No-store API responses; no request logging; no patient/session data in localStorage | Redacted operational telemetry, alerts and incident process |

These are initial control areas for the required OWASP ASVS assessment, not a
completed assessment or compliance claim. Secure cookies and HTTPS origin are
mandatory when `NODE_ENV=production`; that configuration is not a deployment.
Local Compose uses a development database owner. The separate local release uses a restricted runtime account and migration owner;
no live hospital hosting or external identity provider has been configured.

Implementation references checked during this slice:
[Fastify server options](https://fastify.dev/docs/latest/Reference/Server/),
[cookie configuration](https://github.com/fastify/fastify-cookie),
[parameterized queries](https://node-postgres.com/features/queries),
[transactions](https://node-postgres.com/features/transactions), and
[Node cryptography](https://nodejs.org/api/crypto.html).

## Verification

```sh
npm run typecheck
npm run typecheck:server
npm test
npm run build
npm run test:server
npm run test:staff
npm run test:staff
npm run security:source
npm run security:dependencies
```

Server tests create and remove a uniquely named schema in the dedicated database;
they do not truncate the local workspace. Browser tests provision uniquely named
fictional hospitals in the local database. Each sequential browser-file fixture
resets only the development loopback IP login bucket; this is guarded to the
dedicated local database and forbidden in production. It prevents accumulated
synthetic logins across suites from exhausting a shared IP budget. Account
limits stay intact; server integration tests verify the actual rate-limit rules. Their screenshots/reports live in
`artifacts/staff-ui` and `artifacts/staff-report`. Browser traces are disabled for
staff tests so credential submissions are not recorded in trace archives.

The GitHub workflow now prepares its own local database and runs these checks;
it also runs the isolated restore check. Measured results and review dispositions
are recorded in the [outpatient implementation spec](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md).

The browser uses the server expiry timestamp to clear idle views. It also
revalidates sessions on focus/visibility changes and every 60 seconds while visible.
Revocation in another process is detected on the next successful check/request;
network outages can delay that detection. Logout clears all open same-origin
staff tabs even if its response is lost, then offers confirmation retry. Pending
registration blocks in-app exits and prompts before page navigation; deliberately
leaving can still discard the in-memory retry key.

## Connected outpatient workflow

From the directory, check in a patient, then open **Visits**. The visit panel
provides only the sections permitted for the signed-in role. Server responses
also omit restricted sections; permissions are enforced at every command.

| Role | Visit actions | Detailed sections |
| --- | --- | --- |
| Receptionist | Check in | Summary only |
| Clinician | Notes/amendments, request/review/cancel tests, corrected-result review/takeover, prescriptions, close | Consultation, diagnostics, pharmacy |
| Lab | Collect specimen, release/correct result and assign reviewer | Diagnostics |
| Pharmacist | Inventory receipts/adjustments, authorized supply and remainder cancellation | Pharmacy |
| Cashier | Issue catalog invoices, record partial payments | Billing |
| Auditor | Read only | Billing, history |
| Admin | Full synthetic walkthrough | All |

All roles can read the patient directory and visit summaries, including balances
and closure blockers. That is a provisional policy requiring hospital validation.
Only reception/admin can register patients. Admin clinical permissions exist for
synthetic demonstrations; production policy needs clinical/security approval.

New visits require a note, reviewed or cancelled tests and no pending prescriptions
before clinical closure, including acknowledgement of any corrected results.
Original clinical records remain immutable; attributable corrections and billing
remain available after closure. “Not yet billed” is distinct from “Settled.” Historical demonstration
visits retain their original invented charges, settlement and closure behavior;
they cannot receive catalog invoices. The authenticated workspace is available at both `/` and `/staff`.
Hospital product/batch stock and explicit quantity supply are available below. There is no dosing support or insurance processing.

### Clinical amendments and corrected-result review

In Consultation, clinician/admin staff can append an amended note with a required
reason. Diagnostics lets lab/admin staff append corrected result text and assign
an active clinician/admin reviewer. Original text remains visible and unchanged;
ordered amendment history retains text, reasons, actor snapshots and timestamps.
Each changed original is marked and links directly to its latest amendment.
Original author attribution identifies the actor ID and username; its displayed
account name is explicitly current because historical names were not captured.
Reviewer choices include username and role to distinguish identical names.
These actions work on active and closed visits without changing visit revision.

Every result correction creates a fresh review obligation. Only its assigned
reviewer can acknowledge the exact latest correction. Another clinician/admin
can explicitly take responsibility with a reason. Disabled, role-changed or
password-reset owners remain visible as unavailable; takeover keeps the work
recoverable. A new correction after an earlier acknowledgement requires review
again. Reviewing a correction does not replace the original release-review step.

The visit filter **Corrections awaiting review · all visits** includes closed
visits and prioritizes the latest outstanding correction time. Clinician/admin
staff can narrow it to **Assigned to me**; clinical roles see owner and correction
time without exposing narratives in queue rows. Counts and warnings remain visible until acknowledgement. Active closure
is blocked by outstanding correction review; a closed encounter stays closed
while its follow-up remains outstanding. Reviewer assignment is an explicit
operator decision, not an inferred clinical escalation policy.

Visit reads and writes retrieve the latest amendment and exact current review
state independently of history pages. Subject history and auditor metadata history
use explicit 25-event pages with previous/next controls; earlier entries remain
accessible. A later correction clears an outdated save/review success notice.

Migration008 adds append-only clinical amendments, events and exact-retry receipts,
with hospital/subject boundaries, current authority checks and immutable SQL
history guards. Narratives remain restricted to the relevant clinical roles;
auditor history contains action metadata only. Lost responses retain the same
request/key. Stale corrections preserve drafts and require explicit review of the
latest version before another save. Reloading or closing the browser can still
lose in-memory drafts. See the [clinical correction specification](../_bmad-output/implementation-artifacts/spec-clinical-corrections.md).

This implements free-text correction mechanics with fictional data. Signed
clinical templates, result units/reference ranges, laboratory verification,
critical-finding escalation and the production permission policy still require
professional validation. No original authorship is invented where historical
subject metadata is unavailable.

### Pharmacy stock and quantity supply

**Pharmacy inventory** lets admin/pharmacist staff create hospital-specific products
(code, descriptive name/strength/form and base unit) and batches (lot and exact expiry
date). These identities cannot be edited; active and quarantine status changes require
a reason and revision check. New hospitals start with an empty catalog and each batch
starts at zero. Receive stock with a delivery reference, or record a signed whole-unit
adjustment with a discrepancy reason. Immutable movements determine each balance;
negative stock is rejected. Lists and attributable history use 25-entry pages.
Actor names are captured at the time of the action; expandable staff IDs distinguish
duplicate names. Visit history includes the prescription number and original
instruction; global stock history exposes stable visit/prescription IDs. Recorded
lot expiry is shown whenever captured in an event, without inventing missing
historical values.

In a visit's Pharmacy section, clinician/admin staff explicitly authorize one product
and whole base-unit quantity against a pending prescription. Original instructions
remain unchanged. Pharmacist/admin staff select an eligible batch and record actual
supply, up to both available stock and the authorized remainder. Partial supply keeps
the prescription pending and blocks clinical closure. Full supply completes the
prescription atomically with its movement, visit revision, audit and retry receipt.
Linked prescriptions cannot use the unlinked completion action to bypass stock.
An unlinked handoff is explicitly labelled as not accounting for physical inventory.

Remainder cancellation requires a reason and retains all prior supplied stock as
consumed. It does not return units. Supply is blocked for inactive products,
quarantined batches, and batches expiring **on or before the current Addis Ababa
date**, decided by the server. Expiry-day blocking is a conservative provisional
boundary requiring pharmacist/hospital validation, not an approved clinical policy.

Unknown save outcomes preserve the exact command and key; in-app exits are blocked
until retry confirms the result. Stale stock/visit revisions retain drafts and require
review of the current version and renewed confirmation. Refreshing changed stock
clears confirmation and requires explicit adoption of the current eligible batch,
including when the selected batch is on another page. Saved notices confirm only
the committed write; failed refreshes show a separate recovery state. Pharmacy drafts survive visit
tab switches. Reload/closing the browser can still lose in-memory drafts and keys;
check history and balances before re-entering. All stock and visit commands serialize
at the hospital boundary and recheck current authority after the lock.

Auditors can read inventory/history; clinicians can choose active products and read
their visit's authorization/history. These permissions remain provisional. No dosing,
substitution, pack conversion, procurement/purchasing, controlled-item governance,
patient returns/restocking, multiple stores, valuation or approved formulary is
implemented. The synthetic mechanics require professional validation before live
medication use. See the [inventory specification](../_bmad-output/implementation-artifacts/spec-pharmacy-inventory.md)
for migration009, additive010 integrity hardening and engineering evidence.

### Catalog invoices and payment records

In Billing, admin/cashier staff explicitly prepare an invoice from active services.
Review the captured service version, quantity and total before issuing. The server
resolves prices and rejects inactive, foreign or stale selections. Issued lines
are immutable; a later catalog edit does not change them. An administrator can
void an unpaid invoice with a retained reason and prepare a replacement. Paid
invoices cannot be voided; refund/correction workflows remain outstanding.

Record a positive partial or full amount in ETB using cash or manual transfer.
Manual transfers require an external reference; this records an operator's action
and does not verify or move funds. Each accepted payment receives a stable receipt
number and attributed history. Amounts cannot exceed the balance. Zero-price
services are allowed, but zero payments are rejected. Invoice and aggregate
nonvoid visit totals are bounded to 9,999,999.99 ETB; an invoice has up to 20
unique service lines with quantities 1–100. Invoices and history use 25-row pages.
These internal invoice/receipt identifiers are not approved statutory documents.

Unknown save outcomes retain the original request and key for retry. Refreshing a
stale price or invoice preserves the draft and requires renewed confirmation.
Financial writes use separate hospital-scoped, immutable tables and do not rewrite
closed clinical records. Transactions recheck authority after hospital locking;
concurrent payments cannot overpay. Financial access is admin/cashier/auditor
(read only for auditor), with voiding restricted to admin. Migration007 adds the
ledger; the built installation uses explicit insert/read grants and a mutable
number counter. See [billing implementation evidence](../_bmad-output/implementation-artifacts/spec-outpatient-billing.md).

Tax, discounts, refunds, reconciliation, insurance, bank integration and hospital
approval of clinical/financial closure policy remain release prerequisites where
applicable. All current records and tests remain synthetic.

Updates use an expected revision and a UUID retry key. Concurrent changes return
a conflict instead of overwriting another user's work. Lost responses retain the
original request/key for an explicit retry. Pending writes block in-app navigation;
stale conflicts refresh the visit and preserve the typed draft. A separate refresh
action loads department updates without losing drafts. Unsaved drafts require
explicit discard before leaving; result drafts made uneditable by a colleague
remain visible for copying or deliberate discard. Drafts and retry
keys live only in memory and are cleared at sign-out/session changes. Explicitly
leaving or closing the browser can lose them; inspect the visit before re-entering.

Local demo accounts are in hospital `demo`: `reception`, `admin`, `clinician`,
`lab`, `pharmacist`, `cashier`, `auditor`. Each generated password is stored only
in `.local/<username>-password.txt` on the original workstation. These accounts
and files are not shipped by cloning the repository. Provision a new account
using the command above with its corresponding role/name/password path.

## Local backup and restoration check

```sh
npm run db:backup
npm run db:restore-check
```

The tools accept only the dedicated loopback `hospital_dev` database. Backups
include account/session and synthetic patient data and remain in private,
Git-ignored `.local/backups/` files. Do not upload this folder with CI artifacts.
The restore check takes a fresh consistent snapshot, restores into a randomly
named disposable database, compares each public table's count and content digest plus columns, constraints,
indexes, triggers, functions, sequences and views,
and removes that temporary database. It never restores over the source database.
An existing `public` schema is cleaned only inside that disposable database.

This verifies local logical restoration, not production disaster recovery. Database ownership
and grants are deliberately excluded from this development restore comparison.
Off-site storage, encryption/key management, retention, scheduling, recovery time
and recovery point targets still require a deployment decision and drills.
The small-dataset content check is not a production-scale performance test.
Implementation follows PostgreSQL 16 [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)
and [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html).


## Hospital staff administration

Hospital administrators can open **Staff administration** to find named accounts,
create staff, change another account's role/active status, reset credentials and
read attributable administrative history. Every mutation verifies the initiating
administrator's current password. Separate account/IP reauthentication budgets
limit failed and concurrent attempts; successful password checks release their
own reservation without consuming sign-in limits. Usernames
are unique within a hospital. Self-deactivation/demotion is forbidden; the hospital
lock serializes overlapping access changes and preserves an active administrator.

New and reset accounts receive a browser-generated 256-bit temporary password.
Share it privately, then clear it from the page. It is never returned in account
lists or history, logged, put in URLs, or persisted in browser storage. Passwords
and retry fingerprints use salted scrypt. An uncertain administrator command keeps
its exact temporary credential, command and retry key in browser memory until an
explicit retry confirms the result. Reloading or intentionally leaving loses that
credential; use a new credential reset if it can no longer be delivered safely.

Unenrolled temporary-password sessions permit password replacement while
remaining restricted. Enrolled accounts must complete MFA first; temporary
passwords still block workspace access until replaced. All staff can change
their own password (12–256 characters); success
revokes every old session and requires a new sign-in. If that response is lost,
retry the unchanged details or sign out and try the new password. A successfully
revoked session cannot be reused to replay a password replacement.

Account revisions reject stale submissions. Role/status changes and credential
resets atomically update the account, append history and revoke sessions. Account
and clinical history are retained after deactivation/reactivation. Clinical writes
and login recheck current session/credentials after obtaining the hospital lock,
preventing waiting operations from outliving committed privilege removal.

Migration 004 adds revision/password-replacement fields plus separate constrained
administrative events and retry receipts; applied migrations and clinical records
are preserved. Secure CLI bootstrap remains available and never overwrites an
existing account. Roles remain provisional. There is no public registration,
email recovery, MFA, vendor-wide access or production identity readiness.

Coverage: `server/administration.test.ts` exercises tenant/role boundaries,
credential lifecycle, secret exclusion, stale revisions, rollback, bounded attempts
and real database-lock races. `tests/administration.spec.ts` covers desktop/mobile
onboarding, password replacement, access history, keyboard/axe checks, load errors,
dirty-draft navigation, uncertain retry and session-loss secret clearing. See the
[staff administration implementation specification](../_bmad-output/implementation-artifacts/spec-staff-administration.md)
for the dated verification outcome.

Administrative history is paginated (25 events per page) and includes stable actor
IDs and usernames alongside display names. Revision-conflict recovery fetches the
exact hospital-scoped account ID, independent of directory search or pagination.
Privileged account reads share the hospital lock and recheck current authority
before returning records. An uncertain account command retains its original
retry key and temporary credential across throttling or reauthentication errors;
only the administrator's verification password remains editable during recovery.

### Audited operational reports

**Operational reports** accepts inclusive Gregorian dates, interpreted in
Africa/Addis_Ababa, for at most366days. Run report explicitly requests a fresh
hospital snapshot. Dates, generation time and the access record are shown with
the result. Changing dates or a failed request clears the prior result; retry
requests a new audited snapshot of the failed product page. Editing dates or
starting a fresh report returns to page1. Each product page is independently generated,
so concurrent hospital changes can affect later pages.

Admin/auditor accounts receive all sections. Clinicians receive visit operations,
cashiers recorded payments, and pharmacists product stock. Receptionist/laboratory
accounts cannot access this aggregate report. These preliminary permissions need
hospital validation. Responses contain no patient identities, clinical narratives
or payment references; unauthorized sections are omitted by the server.

- **Selected period:** visits opened and closed count their own timestamps
  independently; note amendments and result corrections count recorded changes.
  Receipts count each recorded payment once, split into cash/manual transfer.
  Stock movements show received and supplied units, signed net adjustments and
  their net effect for each product.
- **Current work:** active visits, investigations not yet reviewed/cancelled,
  pending prescriptions (including partial supply), and the latest unreviewed
  corrected results, including those on closed visits. These counts do not use
  the selected period.
- **Current finance:** positive catalog invoice balances after all recorded
  payments, excluding void invoices. Historical demonstration payments/charges
  are excluded. Amounts use exact minor-unit arithmetic; collections are not
  revenue, tax reporting or bank/till reconciliation.
- **Current stock:** whole base units per product, including products with no
  batches. The exclusive categories are inactive product, quarantine, expired,
  expiry today, then available, in that precedence. Category quantities sum to
  total stock. Unlike product units are never added together. Cancelling a
  prescription remainder does not restore previously supplied units.

Migration011 adds immutable report access events containing actor identity,
role, requested dates, authorized sections, timestamp and product page/row count.
The report is delivered only after that audit commits. A shared10-second execution
budget covers pool acquisition, SQL and the audit, with the existing five-second
lock limit where stricter. Exhausted or known-abandoned reads stop further work
and clean up their transaction; the UI can retry a busy response. No CSV or other export is
provided. Read auditing does not replace clinical/pharmacy review, financial
policy validation or the outstanding production security assessment. See the
[report specification](../_bmad-output/implementation-artifacts/spec-operational-reports.md)
for engineering verification.


### Private patient and visit searches

`POST /api/patients/search` accepts `{ q?, page? }`; `POST /api/visits/search`
accepts `{ q?, page?, status?, assigned? }`. Both require JSON, exact Origin,
and the current session CSRF token. Pages are JSON integers (1–10000), default
1; results retain 25-row pages. Queries are literal substrings, with existing
Unicode name normalization and hospital/role scope. Unknown fields, query
parameters, NULs, terms over 100 characters and invalid filters are rejected.
GET lists still support harmless paging/filter fields, but reject any `q`,
including an empty value. Search terms stay in request bodies and UI memory.

Patient directory and detail reads acquire a bounded hospital SHARE lock and
recheck the current session, role, active account and password-change requirement
before reading patient rows. Contention returns a generic retryable 503 and
rolls back the transaction. Connection acquisition failures, including the
initial session lookup, return a generic retryable 503 without patient fields. Tests cover revocation while waiting, tenant isolation,
strict input, private browser transport and pagination. These changes do not
approve provisional hospital roles or complete production readiness: MFA,
operational monitoring, deployment and hospital approval gates remain unresolved.
