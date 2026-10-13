# Staff registration workspace

The `/staff` route adds a PostgreSQL-backed patient directory with authenticated
staff access. The original `/` outpatient walkthrough remains a separate browser
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
npm run dev:api
# In another terminal:
npm run dev
```

Open `http://127.0.0.1:5173/staff`. For the account already provisioned on this
workstation, hospital code is `demo` and username is `reception`. Open the ignored
`.local/reception-password.txt` file locally to retrieve its generated password.
No password appears in documentation or application source. Existing accounts
are never overwritten by provisioning; skip that command when already created.

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
another hospital after authentication. Roles are a preliminary registration policy:
receptionist and admin can read/register patients; auditor can only read.
Clinical roles and staff-management UI are not implemented.

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
again. This first slice does not support edits, merges, deletion, check-in or
clinical records in the server workspace.

## Security implementation and limits

| Area | Implemented evidence | Still needed before live use |
| --- | --- | --- |
| Authentication | Salted, versioned scrypt hashes; generic login errors; persistent bounded login attempts | MFA, recovery, lifecycle policy and staff onboarding review |
| Session handling | Random opaque cookie; hashed token in DB; HttpOnly/SameSite Strict; 8h fixed expiry; revoked logout; inactive-user checks | Idle/session policy validation and managed transport |
| Request integrity | Exact Origin on mutations and session CSRF header; strict validation/body limit | Broader ASVS review and external assessment |
| Hospital boundary | Session-derived hospital predicates; no client-selected hospital; composite foreign keys | Production DB privileges, defense-in-depth/RLS evaluation, clinical role matrix |
| Integrity and audit | Transactional registration/audit/idempotency; author account IDs | Tamper-resistant audit storage, access/security events and retention |
| Data persistence | PostgreSQL schema migration and local named volume | Tested backup restoration, migration release strategy and disaster recovery |
| Sensitive output | No-store API responses; no request logging; no patient/session data in localStorage | Redacted operational telemetry, alerts and incident process |

These are initial control areas for the required OWASP ASVS assessment, not a
completed assessment or compliance claim. Secure cookies and HTTPS origin are
mandatory when `NODE_ENV=production`; that configuration is not a deployment.
Local Compose uses a development database owner. No production least-privilege
account, external identity provider or hospital hosting has been configured.

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
npm run test:app
npm run test:staff
npm run security:source
npm run security:dependencies
```

Server tests create and remove a uniquely named schema in the dedicated database;
they do not truncate the local workspace. Browser tests provision uniquely named
fictional hospitals in the local database. Their screenshots/reports live in
`artifacts/staff-ui` and `artifacts/staff-report`. Browser traces are disabled for
staff tests so credential submissions are not recorded in trace archives.

The GitHub workflow now prepares its own local database and runs these checks;
no remote CI run has occurred. Final measured results and review dispositions
are recorded in the [implementation spec](../_bmad-output/implementation-artifacts/spec-staff-registration.md).

The browser uses the server expiry timestamp to clear idle views. It also
revalidates sessions on focus/visibility changes and every 60 seconds while visible.
Revocation in another process is detected on the next successful check/request;
network outages can delay that detection. Logout clears all open same-origin
staff tabs even if its response is lost, then offers confirmation retry. Pending
registration blocks in-app exits and prompts before page navigation; deliberately
leaving can still discard the in-memory retry key.
