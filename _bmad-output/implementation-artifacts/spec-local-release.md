---
title: Repeatable local release installation
type: feature
created: 2026-10-13
status: done
route: dispatch
review_loop_iteration: 0
baseline_commit: fa4c6e33493e75c88efd77dd45a886655768382f
context: [AGENTS.md, docs/deployment.md]
---

<frozen-after-approval reason="User authorized remaining roadmap and local Docker infrastructure">

## Intent

Provide a reproducible installation of the built web application, API and database
so release behavior can be rehearsed before selecting hosting. Keep ordinary
development and all existing data intact. This is a local synthetic release
rehearsal, not authorization to host clinical records or expose the service.

## Boundaries & Constraints

Always use separate named volumes/project, private generated credentials, HTTPS,
health-gated startup and a runtime database account that cannot own/alter schema
or rewrite audit records. Build artifacts must exclude credentials, test reports,
agent tooling and workstation dependencies. Keep API and database ports internal;
only the local HTTPS entry point binds loopback. Migration runs as a separate
privileged job, never automatically inside each API request/startup.

Never replace development volumes, weaken production cookie/Origin validation,
commit credentials/certificates, open public ports, or claim disaster recovery,
measured capacity, production support or legal readiness. Local certificates
require explicit client trust; do not install a system-wide CA automatically.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| New install | Empty dedicated release volumes and private generated config | Migrate, start healthy API and HTTPS static UI | Missing/malformed secrets fail closed |
| Repeat start | Existing config and volumes | Preserve accounts/data; rerunnable migrations | Do not rotate credentials silently |
| Runtime privilege | API credentials attempt DDL, audit UPDATE/DELETE or migration | Denied; ordinary app operations work | SQL insufficient privilege, no partial damage |
| HTTPS | Sign-in and mutation through gateway | Secure HttpOnly session, matching Origin, successful same-origin API | Foreign Origin rejected; no backend host exposure |
| Packaging | Build from checkout | Compiled server/static assets and production dependencies only | No `.env`, `.local`, source tests or agent files in final image |
| Failure | DB unavailable, migration failure, app shutdown | Readiness fails; no healthy API before migration; bounded shutdown | Redacted diagnostics and nonzero exit |

</frozen-after-approval>

## Code Map

- `server/index.ts` currently binds loopback; allow explicit container bind while
  retaining loopback default, validate configuration and bound graceful shutdown.
- `server/app.ts` already requires HTTPS/Secure cookies in production. Preserve;
  use exactly one trusted proxy hop only in a network with no public API port.
- `server/db.ts` migrates dedicated `product_studio_*` databases; reuse unchanged.
- `compose.yaml`, `.env`, local volume: existing development system stays intact.
- `tsconfig.server.json`: no-emit TypeScript checks. Add release emit config with
  rewritten relative TS import extensions; copy migrations beside compiled DB code.
- `server/setup.ts`: compiled provisioning command remains available to operators.

## Tasks & Acceptance

- [x] `Dockerfile`, `.dockerignore`, `tsconfig.release.json` — build production
  dependencies, emitted server and static frontend with narrow image contents.
- [x] `compose.release.yaml`, `deploy/Caddyfile`, `deploy/migrate.mjs` — isolated
  database, schema-owner job, explicit runtime grants and HTTPS gateway.
- [x] `tooling/release-local.mjs` — private configuration creation and repeatable
  up/stop/status commands, no printed secrets or destructive reset operation.
- [x] `server/index.ts` — validated container binding and bounded shutdown.
- [x] `tooling/release-verify.mjs` — substantive HTTPS/auth/Origin/runtime-grant
  smoke verification with synthetic fixture, safe output and no shared data reset.
- [x] `docs/deployment.md` — exact start/provision/verify/stop commands, TLS trust,
  upgrade/rollback process and remaining production requirements.

Given existing development data, when the release rehearsal starts, then a
different database/volume is used and the original app stays usable. Given a
fresh release instance, when verification runs, then it exercises sign-in,
registration, session handling and SQL permission failures through the built
services. Given an ordinary stop/restart, when signing in again, then records
persist. Given a package failure, when reporting it, then diagnostics do not
include connection strings, cookies or patient narratives.

## Implementation Notes

Review corrections: Compose project selection is an explicit CLI argument, not
ambient environment. If the named database volume exists but configuration is
missing, stop before generating secrets. Verification includes successful
restricted-role check-in, clinical command, staff onboarding/password change,
configuration revisions and immutable history; recovery guards, runtime-image
contents and database-unavailable readiness are exercised too. Review findings
B5/B6/B11/V2/V3 are individually logged in spec-staff-administration.md.


This independent operations slice runs alongside staff administration under the
user's authorization to complete the roadmap. Parent owns release files and
`server/index.ts`; administration builder owns its API/schema and package scripts.
User-facing infrastructure remains local with no purchase/host requirement.

## Spec Change Log

## Review Triage Log

## Verification

Compile/typecheck; build images; fresh local up and health verification; actual
HTTPS/browser sign-in; test API database grants, cookies, Origin and idempotency;
restart persistence; inspect narrow build context. Security and diff review must
cover the resulting code. Update evidence only from actual runs.

### Integrated verification — 2026-10-13

- Frontend and server typechecks passed;14 unit tests passed; production build passed.
- Full API integration suite passed57/57 after review fixes (180.5s).
- Development restore check passed for17 tables, including schema, row counts
  and content digests, using an isolated disposable database.
- Built local release passed HTTPS/Origin/CSRF, session cookie/logout, registration
  and retry, staff create/replay/password replacement, restricted check-in/clinical
  writes, configuration create/update/replay/price history, denied runtime DDL and
  history rewrites, packaging exclusions, project override protection, lost-config
  protection, database-outage readiness/recovery and actual browser sign-in/refresh.
  The same checks passed after full stop/rebuild/restart with prior record retention.
- Final browser regression, independent re-review and source scan of all newly
  staged files remain pending at this checkpoint; do not infer their completion.

### Final local milestone evidence — 2026-10-13

All accepted review findings are resolved. Complete API regression passed61/61
before the last configuration corrections; the final affected configuration
suite passed15/15 and the additive006 migration preservation test passed. The
original complete staff browser suite passed54/54; subsequent affected staff
regressions/onboarding passed six distinct desktop/mobile cases, and final
configuration browser tests passed12/12. Both typechecks and production image
compilation passed. Original14 unit tests passed; their source is unchanged.

Final built release verification passed before and after full stop/start with
migrations001–006, protected HTTPS/session/Origin/CSRF behavior, restricted SQL,
all supported synthetic workflows, 13 prior-run persistence groups and database
outage recovery. Latest logical restore matched schema/counts/digests for17
tables. Final Semgrep scanned112 targets with zero findings; configured Trivy
high/critical and npm audit checks passed. No credential files were staged.

Independent staff and bounded configuration-picker visual reviews returned
**ship**; final overlap-notice captures were checked at desktop/mobile sizes.
Design documentation check preserved the incumbent system. Two rare direct-SQL
configuration suggestions were rejected with reasons in the configuration
triage log; no accepted finding is deferred. GitHub verification is pending the
push of this milestone; local evidence does not imply a production release.
