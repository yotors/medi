---
title: Hospital-scoped staff registration
created: 2026-10-13
status: done
route: dispatch
baseline_commit: UNBORN_HEAD
context: [AGENTS.md, DESIGN.md]
---

<frozen-after-approval>
## Intent
Let an authorized staff member sign in and register/search patients belonging to their hospital, with durable server persistence. This is the next coherent slice toward the reusable hospital product. Keep the existing outpatient browser demonstration at `/`; add the authenticated registration workspace at `/staff`.

## Boundaries & Constraints
Local synthetic development only, no hosting or live data. PostgreSQL and Fastify/TypeScript are reversible implementation choices. Staff provisioning is an explicit local CLI; no public signup or hospital selector that changes authorization. Hospital is derived exclusively from the authenticated account. Roles: receptionist/admin can register and read; auditor can read only. No clinical records exposed. No connection/import of browser demo data, medical workflow migration, MFA, password recovery or production readiness claim.

Use parameterized SQL, database migrations, unique hospital record numbers, transactional registration with attributable audit event. Serialize same-hospital registration to guard duplicate-name checks. Require explicit duplicate-name confirmation. Idempotency key UUID ensures retry creates only one patient; changed payload with same key returns conflict. Reject unknown request fields including hospitalId. Bound fields: name1–100, optional age integer0–120, optional contact<=100. No patient email requirement.

Opaque random server sessions stored hashed; salted scrypt passwords, HttpOnly SameSite=Strict cookie, fixed expiry, logout revocation and inactive-user denial. Production configuration requires HTTPS/Secure cookies; local development binds loopback. Mutations require exact configured Origin; authenticated mutations also require session CSRF header. Login JSON only, generic failures, persistent bounded rate-limit buckets without storing raw usernames/IP. No request bodies/cookies/passwords or patient names in HTTP logs/errors. No-store response headers. Database credentials and generated staff passwords never printed or committed.

## I/O & Edge-Case Matrix
| Scenario | Input | Result |
| --- | --- | --- |
| Unauthenticated access | patient API | 401, no records |
| Cross-hospital access | foreign patient UUID | 404, no leak |
| Registration | valid fields and new key | 201 patient + audit, same record after restart |
| Retry | same key and identical payload | same patient, no second audit |
| Conflict | changed body/same key or duplicate name | 409 explicit recovery |
| Wrong origin/CSRF | mutation | 403, no write |
| Read-only staff | create | 403 |
| Expired/revoked session | any protected API | 401 and UI clears records |
</frozen-after-approval>

## Code Map
Existing `src/App.tsx` and `src/domain.ts` remain the browser walkthrough. New `src/staff/` uses fetch and in-memory state only; `src/main.tsx` chooses pathname. Reuse stylesheet/fonts/icons. Vite proxies `/api` to loopback3100 without changing browser origin. No remote or first commit; preserve all existing untracked files.

## API contract
All errors `{code,message}`. Server `buildApp({pool,origin,secureCookies?})` exported for injection tests; CLI binds127.0.0.1:3100. Shared Zod schemas/types in `shared/registration.ts`, owned by parent, are authoritative.
- POST `/api/auth/login` `{hospitalCode,username,password}` → `{user,csrfToken}` plus cookie. User `{id,displayName,role,hospital:{id,name,code}}`.
- GET `/api/auth/session` → same envelope. POST `/api/auth/logout` →204.
- GET `/api/patients?q=&page=1` → `{patients,total,page,pageSize:25}`; deterministic newest-first; bound query<=100 and page<=10000.
- GET `/api/patients/:id` → `{patient}` with same hospital predicate.
- POST `/api/patients` `{name,age?,contact,confirmDuplicate?}` + `Idempotency-Key` + `X-CSRF-Token` → `{patient}`. Patient `{id,recordNumber,name,age?,contact,createdAt}`. Duplicate error code `DUPLICATE_PATIENT`; idempotency conflict `IDEMPOTENCY_CONFLICT`.

## Tasks & Acceptance
- [x] `shared/registration.ts` — common validation/types, no secrets.
- [x] `server/migrations/001_registration.sql`, `server/db.ts`, `server/auth.ts`, `server/app.ts` — schema, sessions, permissions, hospital-scoped reads and transactional writes.
- [x] `server/index.ts`, `server/setup.ts`, `compose.yaml`, `.env.example`, `tooling/local-db.mjs` — safe local startup/provisioning with random ignored credentials; never overwrite existing accounts or touch sibling databases.
- [x] `src/staff/StaffApp.tsx`, `src/staff/staff.css`, `src/main.tsx`, `vite.config.ts` — sign-in, directory/search/pagination, inline registration, duplicate handling, retry and sign-out.
- [x] `server/registration.test.ts`, `tests/staff.spec.ts`, `playwright.staff.config.ts`, CI — meaningful isolation/auth/replay/rollback/durability and browser tests.
- [x] `docs/staff-workspace.md`, readiness/README/spec — setup, measured evidence, limitations, security mapping.

Given two hospitals, when each signs in, then neither can read/create in the other by changing identifiers, query, body or headers. Given invalid credentials or session, no patient data appears. Given uncertain registration response, retry with unchanged key returns one record. Given mobile or desktop, keyboard registration/search/logout work with accessible labels and visible errors. Given server restart, prior patient/session remains until expiry. Login and registered patient fields are not persisted in browser storage.

## Implementation Notes
User delegated continuation of product development. No additional approval needed for reversible local implementation; preserve the known unborn/untracked tree. No unresolved user-only choices in this bounded slice. Production deployment/clinical validation remain deferred. New database is dedicated to this project; migrations apply only there. Do not stage/commit/deploy.

## Spec Change Log

## Review Triage Log

Three independent context-free code reviews completed. Findings are individually
recorded below, including duplicate reports. Concrete corrections stayed within
this authorized slice; no unrelated changes were reverted or staged.

| Reviewer finding | Verdict / action and evidence |
| --- | --- |
| Blind1: stale restore after identity broadcast | high; fixed generation guard on restore success/error/finally; delayed-response browser regression. |
| Blind2: normalized duplicate not searchable | medium; same normalization for normalized_name search; double-space/fullwidth/literal-wildcard server regression. |
| Blind3: NUL accepted by PostgreSQL text inputs | medium; registration/login/provision/query reject NUL; invalid-fields and provisioning regressions. |
| Blind4: uncertain logout leaves other tabs visible | high; clear/broadcast regardless of response, explicit unconfirmed logout with retry; two-tab dropped-response browser regression. |
| Blind5: navigation loses uncertain registration key | medium; pending blocks header links/sign-out, beforeunload warning; retry test checks controls, intentional leave limitation documented. |
| Blind6: idle pg error crashes API | medium; sanitized pool error handler; EventEmitter regression. |
| Blind7: password file strips spaces | medium; remove one LF/CRLF only, preserve spaces; decoder regression. |
| Blind8: scripts require env file despite supplied env | medium; optional env file flag permits environment-only configuration. |
| Blind9: no first-sign-in documentation | medium; README and staff-workspace runbook now distinguish routes and document setup/provisioning. |
| Edge1: stale restoration returns old hospital identity | high; same verified root cause as Blind1, guarded and regression covered. |
| Edge2: NUL creates unfixable retry | medium; same root cause as Blind3;400 before DB rather than500. |
| Edge3: lost logout keeps other-tab records | high; same root cause as Blind4; explicit invalidation and confirmation retry. |
| Edge4: idle expiry/revocation leaves records indefinitely | high; server expiry returned, local expiry timer and minute/focus/visibility validation; focus-triggered revoked-session browser regression. Remote revocation detection bounded by network/check, documented. |
| Verification1: optional fields unasserted | medium; browser age0/contact assertions before and after reload. |
| Verification2: UI pagination untested | medium;26records, next/previous distinct rows, search resets page; desktop/mobile. |
| Verification3: unrelated schema guard untested | medium; sentinel schema rejection/preservation regression. |


## Verification
Typecheck/build, existing14unit and12browser cases, PostgreSQL-backed integration suite and staff desktop/mobile tests including axe, source/dependency scans. Inspect one screenshot batch and at most one correction batch. Three independent bounded reviews per BMad; final UI review per Impeccable. Record actual results rather than predicted coverage.

Implementation ownership: delegated builder owns only `server/` including migrations, auth/API, setup CLI and PostgreSQL-backed integration tests. Parent owns shared schema (already written), UI, local database tooling, package scripts, CI, documentation and browser tests. Builder must not change parent-owned files. Keep server exports/API exactly as contract; send setup CLI interface early. This division permits independent useful work.

### Implementation evidence

Backend: PostgreSQL migrations, sessions, role/tenant predicates, transactional
registration/idempotency/audit and provisioning. UI reuses existing tokens and
adds a separately loaded `/staff` route. Existing demo remains browser-only.
Local .env and password file are ignored/private; security scans exclude those
runtime secrets while checking `.env.example` and all application source.
Automatic approval for one API restart timed out; a permitted single retry
succeeded. No unresolved approval blocker remains.

Initial authentication browser failures used a stale API process after the new
hash format; restarted and updated only the new fictional demo account. Initial
axe landmark violation fixed by labelling the development notice as a landmark.
Current remaining verification recorded below after final checks.

### Final results — 2026-10-13

- TypeScript app/server checks and Vite production build passed.
- Existing14unit tests passed. PostgreSQL integration18/18passed (37.7seconds);
  final NUL-validation additions reran the affected test successfully.
- Existing outpatient browser12/12passed; new staff browser14/14passed
  (84seconds), desktop/mobile, including optional fields, pagination, delayed
  restore and lost logout response. Staff sign-in/directory axe checks zero.
- Semgrep49rules,73targets, zero findings; scan target list includes all server
  files. Trivy HIGH/CRITICAL exit0, two dependency manifests, no reported findings;
  it detected no infrastructure config targets, so Compose is not claimed
  automatically assessed. npm audit including dev dependencies: zero advisories.
- Screenshots: `artifacts/staff-ui/`; report: `artifacts/staff-report/`.
  Bounded independent visual review: ship for development review.
- No clinical/backend visit migration, production deployment, MFA/recovery,
  backup restore, remote CI or compliance assessment completed. Those remain
  documented follow-on work. No commits, staging or push performed.
