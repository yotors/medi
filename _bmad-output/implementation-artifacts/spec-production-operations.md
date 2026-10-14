---
title: 'Production operations, upgrade safety and installation verification'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: c5306163df4b90a05977d8eca287c5a9b2072a31
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/docs/deployment.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/docs/security-evidence.md'
---

## Delivery constraint

The founder authorized completing production engineering and explicitly requested reducing token and credit consumption. Deliver the following operational stages in sequence within one implementation handoff, with focused tests after each change and one final integrated review. Do not repeatedly regenerate plans, reread unchanged files, run unchanged broad suites, or manufacture a minimum count of review findings. Preserve the tested application and genuine old recovery artifacts. There is no authorization to launch externally or use real patient data. Clinical, legal and operator acceptance remain explicit external gates, not invented test results.

This spec consolidates previously investigated requirements. Sections below remain implementation requirements unless a specific contradiction is resolved and documented. Baseline Git identity will be recorded after MFA delivery. No implementation starts before that handoff.

<frozen-after-approval reason="User authorized production-readiness engineering and local synthetic operational drills.">

## Intent

**Problem:** Operators cannot safely diagnose availability, failed authentication or unexpected failures; disabled application logs do not prevent database diagnostics from exposing sensitive fields.

**Approach:** Add manual allowlisted traces/metrics and structured operational logs, complete durable identity/security events, and prove telemetry/alert behavior on the isolated local release. Keep patient content and credentials out of the entire telemetry stack.

## Boundaries & Constraints

**Always:** Manual OpenTelemetry instrumentation only, explicit resource/attribute allowlist, no automatic process/environment/host detectors or incoming baggage/trace propagation. Server-generated correlation UUID, constant registered route templates, fixed method/status/error-class enums. Never put correlation in metric labels. Bounded exporter queue/timeouts/shutdown; exporter failure cannot fail hospital requests. Critical identity changes and their durable audit commit atomically; audit failure denies that change. Throttled floods produce bounded aggregates, not unbounded event inserts. Reuse MFA security events after examining final schema. Configure PostgreSQL diagnostic privacy and bounded Docker log rotation. Collector/monitoring endpoints stay on private network, no new host exposure. Defaults are local drill thresholds, not hospital SLOs.

**Never:** Export raw URL/query/body/header/IP/username/patient/hospital IDs, SQL, exception text/stack, passwords/factor/recovery secrets or environment variables. Do not claim a firing local rule proves notification of a human. No paid service or external endpoint without reviewed deployment plan.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Normal request | Known route, authenticated workload | One span/completion, fixed-label metrics and safe correlation | No sensitive fields |
| Malicious input | Unique markers in query/path/body/headers/error/SQL parameters | Marker absent from API/web/DB/collector output and security rows | Generic failure/status preserved |
| Unknown routes | Many random paths/methods | Bounded constant labels, no unbounded metric cardinality | Unknown category |
| Export failure | Collector slow/down, queue full | Bounded drop/failure indication; application remains usable | No diagnostics containing payload/environment |
| Authentication | Success, allowed failure, logout, recovery/reset | Fixed attributable security event, transactional on state changes | Audit insert failure rolls back state/cookie success |
| Abort/shutdown | Client disconnect or process termination | End-once spans, bounded flush and resources closed | No hang or double metrics |
| Alert drill | Local outage then recovery | Rule firing and resolution plus local synthetic receiver evidence | Failed receipt fails drill, no human delivery claim |

</frozen-after-approval>

## Code Map

- `server/index.ts`: telemetry initialization and bounded shutdown before pool close.
- `server/app.ts`: request/response/error hooks, authentication transactions, generated correlation and safe event classifications.
- `server/auth.ts`, MFA/security module from preceding stage: existing attempt budgets and identity event hooks; do not create duplicate or secret-bearing event trails.
- `compose.release.yaml`, `deploy/Caddyfile`: private network and logging; database default error statements/parameters need explicit suppression.
- `tooling/release-verify.mjs`: built runtime and outage rehearsal; extend with private collector/alert checks separately from source transaction reconciliation.

## Tasks & Acceptance

**Execution:**
- [x] `server/observability.ts`, `index.ts`, `app.ts` — manual SDK interface injectable in tests, safe logs, route/status metrics, duration/inflight/pool gauges, failures/drops, end-once spans. Pin actual compatible OTel packages/lockfile after official API verification.
- [x] Existing security events module/migration/grants — complete login/logout/failure/denial coverage with fixed data fields, flood suppression and transactional success audit, immutable runtime history.
- [x] `deploy/observability/`, release Compose — private collector, bounded trace/log retention and Prometheus rules, local synthetic notification receiver without external communications. Explicit PostgreSQL logging controls and Docker log limits.
- [x] `server/observability.test.ts`, operational tooling tests — every matrix row, fake collector failure/overflow, malicious markers and audit rollback; deterministic promtool rule fixtures.
- [x] `tooling/observability-verify.mjs`, package/CI — actual collector receipt and outage/firing/resolved/synthetic receiver drill with sanitized evidence; source/restore/release checks remain passing.
- [x] Deployment/security/production-plan docs — exact data allowlist, protected destinations, configured retention, remaining independent log storage/real notification ownership and operational limits.

**Acceptance Criteria:**
- Given synthetic sensitive markers in all input surfaces, when every telemetry destination is inspected, then none contains those markers and the API still provides useful fixed-class failures.
- Given collector failure or aborted requests, when workload continues, then application availability and bounded shutdown hold and metric labels remain bounded.
- Given an identity state change whose audit cannot commit, when requesting it, then no successful session or recovery state is exposed.

## Implementation Notes

Investigation verified OTel sdk-node/exporters0.223.0 and metrics/trace-base2.12.0; inspect installed exact types. Disable SDK autoDetectResources and propagation; never use general auto-instrumentation. Explicit bounded span batches/queue and exporter deadlines. Security events contain verified actor/hospital only in protected DB, not general telemetry. PostgreSQL logging must avoid statements/parameters/DETAIL; validate real synthetic error output rather than assuming API logger covers the DB. Local Prometheus evaluation plus private synthetic receiver proves wiring only; real service owner/escalation remains external.

## Spec Change Log

2026-10-14 implementation preserved the declared scope. Static install input validation
is explicitly configurationValid/runtimeVerified:false/ready:false; a separate packaged
preflight derives machine evidence. A bounded private readiness probe supplements API
heartbeat so a running API with failed database health alerts. CHECK canonicalization
uses a round trip of pinned historical SQL, preserving rejection of arbitrary drift.
Post-overload recovery allows the existing two-second negative readiness cache to
expire within a bounded measured retry window; steady thresholds are unchanged.

## Review Triage Log

Root's bounded independent review covered telemetry privacy, schema/privilege admission,
restore/upgrade, workload and preflight. Findings addressed: stdout backpressure drops,
running-but-unhealthy alert, distinction between attestations and runtime evidence,
nonzero failed-machine-preflight exit, existing-network CI fixture refusal, and legacy
schema11 staff_sessions privileges without UPDATE. Focused delta checks covered exact
privilege refusal and workload reconciliation. No external release approval inferred.

## Verification

Typechecks/build, scoped API and operational tests, promtool, exact-source/dependency scan, real packaged collector+alert drill, database restore and final CI. Official references: https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html and https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/.

### Primary documentation checked during the preceding stage

- OpenTelemetry Node SDK configuration documents automatic resource detection, default W3C/baggage propagation and exporter environment fallbacks: https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html . Do not inherit those defaults accidentally. Construct providers/resources/exporters explicitly or disable all detectors, propagation and unspecified exporters. Validate installed pinned APIs; docs can describe newer packages. Test hostile OTEL_RESOURCE_ATTRIBUTES, OTEL_SERVICE_NAME, exporter header/endpoint and propagation environment settings cannot introduce identifiers or an unauthorized destination. Application config owns the allowlisted private collector endpoint.
- Collector configuration: https://opentelemetry.io/docs/collector/configuration/ . Configure explicit private interfaces, bounded memory/batches and safe exporter output; no automatic sensitive receiver metadata.
- PostgreSQL16 logging: https://www.postgresql.org/docs/16/runtime-config-logging.html . Hiding statements and bind parameters alone is insufficient: error messages themselves can contain submitted values. Verify actual database errors using unique synthetic markers and inspect the complete persisted output path. Either discard raw database diagnostics at the container logging boundary with health/metrics replacing routine diagnostics, or prove a complete redaction boundary; do not claim log_error_verbosity=terse removes every user value. No live data or secret may be needed for verification.

The current release image verifier intentionally creates invalid constraints and permission denials; apply diagnostic privacy before those checks and verify old retained recovery images/configuration retain their documented historic limitations. Current-version packaged/recovery containers must use the hardened policy. Keep trace/metric data synthetic; expose no collector, Prometheus or alert receiver on host interfaces. Local receiver delivery must be verified independently of rule state.

### Identity event integration checkpoint (revalidate after MFA review)

MFA adds identity_security_events with tenant/user foreign keys, mutually exclusive staff actor versus operator reference, a fixed event allowlist and runtime INSERT/SELECT-only access. Unknown-account failures cannot honestly be attributed to an existing staff user. Preserve attributable successful identity changes; use bounded durable time-bucket aggregates for unknown authentication floods, rather than fabricating an actor or adding arbitrary submitted account strings. Any schema extension must retain immutability and scoped attribution for known actors. Define retention/rotation responsibilities without silently deleting audit history. Monitoring counters are not a substitute for transactional identity-change evidence.

Review unexpected process-level failures as well as route errors: no unhandled rejection, uncaught exception or exporter diagnostic should print an arbitrary error object/stack containing submitted values. A terminal unexpected process failure must emit a fixed safe diagnostic and terminate for supervised restart; do not swallow it and continue a possibly corrupted process. Tests should inject a synthetic marker into the error object and verify sanitized output and termination, with bounded shutdown. Keep application startup/config errors generic and report safe check identifiers for operator diagnosis.

### Authentication and readiness integration details

After the reviewed MFA correction, reuse its bounded, coalesced readiness validator. Telemetry hooks must not turn every health probe back into an all-account decryption scan. Collector availability is a separate degraded operational signal and must not gate clinical API health or force restart loops.

Distinguish accepted password/restricted sign-in from completed authentication in event names. A failed password identifies an attempted target at most, never a proven actor. Do not populate actor_id using the guessed username's record. Session-authenticated denials can be attributed to the verified session; unauthenticated failures use bounded fixed-code time-bucket aggregates. Preserve the existing mutually exclusive verified staff/operator attribution for successful identity changes and append-only audit permissions. Specify the aggregate retention interval and maximum bucket cardinality explicitly; keep aggregate maintenance separate from immutable identity history. Shared generic counters must not serialize every normal request under one global lock.

Route templates come from registered route metadata, not by replacing arbitrary path segments with guessed patterns. Map unknown routes/methods/statuses to fixed enums, suppress query and headers entirely, and reject incoming correlation IDs as evidence sources. No tenant/user/session/process-instance identifier in exported metrics; no hostname or environment resource detection. Safe fixed service name and validated release version are sufficient. Ensure console/OTel diagnostic logging cannot bypass the structured allowlist.

MFA review iteration2 now requires bounded durable denial/throttling aggregates and read-only budgeted setup status. Reinspect its final migration/schema and reuse the aggregate mechanism when completing other login/authorization failure coverage; do not implement a duplicate failure table or claim these aggregates are individual immutable events. Preserve its per-outcome bounds, fixed keys and retention.

Registry compatibility rechecked 2026-10-14 with npm view: sdk-node0.223.0 peer @opentelemetry/api>=1.3.0<1.10.0; sdk-metrics2.12.0 requires api>=1.9.0<1.10.0; exporter-trace-otlp-http0.223.0 peer api^1.3.0. Pin api1.9.x satisfying all only after checking exact published version, then installed types. No package was installed during this planning query.

Alert semantics: scraping a healthy collector does not prove the API is healthy. The API outage drill must actually stop/fail the synthetic API path and produce an API availability/staleness alert, not merely assert collector up. Use a bounded freshness/heartbeat or explicit private probe, distinguish API failure from collector/export failure, and verify both resolved state and receiver receipt after recovery. Collector-retained last samples must not mask a stopped API. Keep alert labels fixed and non-identifying.

Final pre-dispatch code-map checkpoint: migration012 identity_security_events requires nonnull hospital/user and exactly one verified staff actor or operator reference. Its event check currently covers grant/factor/code/key lifecycle only. Migration014 mfa_rejection_buckets has operations verify/start/recover/confirm/regenerate/replace/grant, outcomes denied/limited/unavailable and24 slots (504 rows). Extend constraints deliberately with a new migration rather than rewriting applied migration files. Existing onError aggregate hooks must emit once when integrated with general error hooks. Iteration3 proof reservations refund successful MFA independently of rejection evidence; telemetry failure must not turn a committed authentication success into an error.


## Intent

Prevent older applications silently serving newer schemas and verify an actual pre-MFA installation can be upgraded with historical records retained. This follows encrypted recovery and MFA. It does not perform external deployment or switch live traffic.

## Requirements

- Inspect current migration runner and recovery APIs before freezing this draft. Preserve genuine pre-MFA archive and image references captured by encrypted-recovery stage; never substitute a backup created from the new schema and call it an upgrade.
- One explicit application schema manifest drives migration file versions and compatibility checking. Reject unknown/future, duplicate, noncontiguous or missing historical versions before any migration writes. Migration filenames/content must be immutable; record checksums for new entries with a deliberate verified baseline for existing entries, not arbitrary trusting of externally modified SQL. Do not use a runtime owner role to validate schemas.
- API startup/readiness and protected entry refuse missing/unsupported schemas with generic diagnostics; no public version details or SQL contents. Production packaged migration remains separate. Recheck relevant compatibility on readiness; document concurrent upgrade constraints and stop application writers during schema changes.
- Restore genuine old archive into isolated target using recorded old image, verify exact old baseline first; migrate with explicit new artifact IDs and required key/config, then verify legacy domain histories and quantities unchanged. Expected authentication-session invalidation is separately asserted and must not be treated as data loss.
- Run synthetic new-version sign-in/MFA/read and one exact-idempotent write, restart new API and verify persistence. Test a failing migration in an isolated target and prove transaction rollback leaves original version/data intact. Unknown-version refusal must happen before schema modifications.
- Demonstrate replacement rollback by restoring original archive into another isolated old-version installation; verify baseline and sign-in. Do not imply application downgrade against a newer database is safe. Source release remains untouched except bounded authorized source availability drills already documented by recovery tooling.
- Archives and original keys/images remain private and retained. Cleanup generated targets only. Never silently remove old images, original DB volumes or accepted backups.
- Tests: future version/missing history/failed migration/normal migrate replay/startup-readiness mismatch; full upgrade drill and backward replacement drill, no secret output. CI creates a reproducible genuine old fixture from a pinned prior commit/artifact (not current source with dropped columns); no build from untrusted remote branch.

## Code map

server/db.ts presently accepts registration_migrations marker and applies missing integer versions without validating future versions or history gaps. server/index.ts starts without schema-version validation; /api/health uses the bounded/coalesced MFA envelope-readiness validator. Preserve that bound when adding schema compatibility checks. deploy/migrate.mjs assigns per-table runtime grants and refuses unknown table grants. New recovery tooling supplies exact old-image baseline and isolated project boundaries; extend its validated orchestration, not shell arbitrary archived paths.

## Verification and ownership

Record exact old/new Git/image/schema identities, unchanged historical tables/digests, explicit allowed session transition, failure rollback and replacement recovery durations. No production RTO, operator acceptance, compatibility promise for untested versions or live traffic switch is inferred. Root owns independent reviews and final CI. Draft must be adapted to actual MFA/recovery implementation before dispatch.

### Reproducible old release and upgrade admission

The retained local old baseline uses schema versions 1–11 and archive `.local/release-backups/pre-mfa-final.medi`, independently held `.local/recovery.key`, pinned image suffix `6e87f22730907761e0ddd405`. The source code of the old backup-capable release is Git commit `bb2d61eca859415e458fc753a5a3787b267fa987` (contains recovery tooling but no MFA). CI may materialize this exact already-reviewed commit using the checkout's fetched history or a fixed secondary checkout and build it with its own locked dependency tree. Do not use a moving main or remote shell script. Record both old/new image IDs and schema inventories; original archive remains untouched.

For legacy checksum adoption, a new migration manifest can know the exact historical hashes of committed SQL files 1–11. Validate those files against compiled/pinned expected hashes before recording previously absent checksums. Do not silently adopt an arbitrary on-disk migration body simply because its integer version exists. An older database with untrusted schema changes must fail the baseline schema/privilege comparison; version rows alone are not proof of compatibility. The new application must not execute migrations under its restricted runtime identity. Migration startup is an explicitly serialized owner operation.

The old source's valid sessions may be revoked by new MFA policy. Compare clinical/financial/inventory histories and quantities separately from expected session/security-state transitions. Do not compare entire database hashes after authorized session revocation and call legitimate migration a failure, or exclude all identity data and hide unrelated user changes. Define the exact allowed changed tables/columns and preserve staff names, role assignments, password hashes and active status. New synthetic verification rows are written only after historic comparison.

Replacement rollback restores a separate verified old installation. A rehearsal does not switch the source origin, delete a failed upgrade volume or claim data entered after the backup is recoverable. Document this recovery point and the controlled maintenance/traffic-cutover procedure for an eventual operator; no automatic user-facing rollback on an uncertain database state.

Current orchestration checkpoint: release-recovery.mjs is a top-level CLI, not an exported target callback. Refactor narrowly to a trusted internal with-isolated-target lifecycle if needed, retaining authentication-before-manifest, generated project identity, private/no-hostport networks, exact image validation, bounded commands and cleanup-before-success. Do not add arbitrary manifest-supplied command callbacks. deploy/migrate.mjs currently applies migrations and grants in separate transactions; explicit image migration failures must never lead to an API served with incomplete grants. Grant table inventory must include new security aggregate tables from final MFA/observability schema. Historical evidence compares the pre-upgrade inventory while newer baseline schema checks account for deliberately added columns/tables.


## Intent

Measure the delivered installation with a declared synthetic workload and validate its configuration before an operator attempts a pilot. This stage follows MFA, telemetry and recovery. It is not a hospital capacity commitment or an externally approved deployment.

## Workload

Prefer a dedicated disposable installation generated through recovery tooling, not the founder's development database. Seed two hospitals with deterministic fictional records at explicit scale; define virtual users, role mix, read/write distribution, ramp, steady interval, timeout, error classifications and thresholds before executing. Start with 10 simultaneous staff sessions for 3 minutes, 2 hospitals x 1,000 patients, 250 encounters each, and explicitly distributed registration/check-in, directory/search, queue/detail, and controlled invoice/payment/review cases. Validate exact invariant totals and no duplicate receipts/negative stock/cross-hospital observations after run. MFA sessions obtained through proper restricted challenge, never database-injected complete sessions. Secrets stay private; results are aggregates without request/response bodies. No billing test is clinical or tax approval.

Record image IDs, schema, Node/Postgres versions, allocated memory/CPU and host environment. Report p50/p95/p99 by bounded route class, error rates, successful operations, pool waiting and memory. Candidate smoke thresholds are engineering hypotheses, set before run and retained if violated; investigate/fix actual bottleneck or report measured bound, never loosen after failure to fabricate success. Avoid claims that a 3-minute workstation test establishes a production SLO or sustained hospital scale.

Test overload using bounded concurrency and time; assert generic503/429, no partial data or pool leak, and recovery after load stops. Synthetic login-abuse probe stays confined to its own accounts/address buckets and never locks founder users. Existing k6 root-page smoke remains tooling-only; new authenticated runner has a separate explicit command.

## Preflight/runbook

Validate exact HTTPS origin/proxy boundary, supported schema and immutable image identities, MFA key references, restricted runtime grants, private configuration, backup image/key availability, monitoring exporter health, service disk/rotation limits and successful restore evidence. Failure reports fixed safe check names, never env values or SQL. Separate automated evidence from external signoffs. Preflight can output not-ready with a list of decisions, but cannot invent hospital/legal/operator approval or force cloud creation.

Prepare two concrete topology templates: a hosted dedicated installation per hospital and a hospital-local server, both browser clients, private DB/API and HTTPS gateway. Shared SaaS tenancy remains provisional application isolation, not approved shared hosting. No offline synchronization promise. External ingress remains disabled until founder chooses host/domain/operator; do not expose services, buy infrastructure or generate a production certificate from the dev CA.

Keep production secrets out of Compose rendered output/artifacts. Pinned images, no automatic destructive upgrade or volume removal. Bootstrap/recovery require explicit operator identity/private grant and separately held backup/MFA keys. Describe support access, initial staff setup, shutdown/restart, release verification, alert escalation and replacement restore procedures based on implemented commands. Prepare exact founder checklist only after local engineering is verified.

## Verification

Meaningful negative config tests, declared workload run with aggregate artifact, invariant reconciliation, overload/recovery drill and clean isolated resource teardown. Run relevant static/runtime security checks against owned synthetic deployment. A passive unauthenticated scan is labeled as such, not full authenticated penetration testing. Record external blockers accurately. Adapt this draft to actual prior stages before dispatch.

### Concrete rehearsal contract to preserve when finalizing

Use five distinct staff identities per hospital (receptionist, clinician, laboratory, pharmacist, cashier), ten concurrent sessions total. Provisioning admin is setup-only. Seed work in valid preconditions so each role can perform its own authorized actions; no test bypass of role checks. Use a deterministic work assignment to avoid counting deliberately invalid workflow commands as throughput. Define 10-second ramp, 180-second steady state, 1-second think time, HTTP timeout 10 seconds; first-run hypothesis: non-login p95 below 1,500 ms, unexpected failures below 1%, zero invariant/tenant violations. Report observed results even when a threshold fails. Login/MFA provisioning happens before the measured interval and is reported separately because password hashing is intentionally expensive.

Count user-visible operations and network retries separately. Retry only documented transient responses with the exact original idempotency key and payload; never silently regenerate a financial command. Bound each retry count. Reconcile issued receipt totals in minor currency units, idempotency histories, dispensed quantities and stock ledger changes against committed workload commands; count rejected writes explicitly. Record all expected conflicts/denials separately from failures; do not exclude timeouts or transport failures from the denominator. Synthetic markers must never appear in aggregate evidence.

Use trusted orchestration to create the isolated workload target and retain it only during the test callback. Do not add arbitrary archived command hooks or an unguarded keep-target CLI option to recovery. API/service endpoints remain on generated private networks; only an explicitly local browser test origin may be exposed to loopback when necessary. No load against unknown/public hosts. Test DNS/private-origin/loopback validation and refusal of source project/volume identity.

Installation templates are parameterized manifests and preflight inputs, not an automatic provisioning service. Prefer immutable image digests with an explicit release manifest tying Git/schema/config versions together. Reject mutable image aliases in live-install preflight. Keep the existing local rehearsal commands and their synthetic CA clearly separate from live TLS configuration. Produce a versioned install bundle without secrets; operator supplies private files only after infrastructure selection.

MFA review iteration3 adds a concrete packaged-release operator procedure/wrapper with target verification and private grant output; reuse its final API for deployment bootstrap/recovery instructions. Never direct an operator to generic checkout npm commands that implicitly read development .env when the intended target is the packaged installation. Operator transaction deadlines and uncertain commit handling remain part of preflight/runbook evidence.


## Implemented local handoff evidence (2026-10-14)

- Genuine retained archive/key/images untouched. Upgrade1–11->15 compared33 historical
  projections, revoked only expected sessions, passed real MFA/idempotent write/restart,
  injected transactional failure, extra legacy privilege refusal and old replacement
  in87s. Exact artifact identities are recorded in docs/production-operations.md.
- Isolated capacity:2x1,000 patients/250 encounters,10 sessions,10s ramp/180s steady,
  unchanged p95<1500ms/error<1%/zero invariants contract.1,818 measured successes,
  p95 max101ms,0 failures/invariants/retries; abuse/overload/recovery passed. Exact
  images/environment/route percentiles: docs/operations-capacity-2026-10-14.json.
- First capacity attempt overlapped fullserver tests and failed immediate recovery;
  old harness omitted aggregates on failure. Retained as failed evidence; corrected
  harness preserves failure aggregates and permits bounded readiness recovery.
- One fullserver run:178/186 passed; eight failures from old migration/event fixture
  assumptions (four inventory failures cascaded). Focused historical migrations2/2
  and MFA operator2/2 passed after fixture correction; affected inventory file passed18/18 separately. Final CI provides the next full regression.
- Parent independent bounded review addressed all material findings. Parent reports
  npm audit0 and configured Trivy exit0; final source/runtime scans and CI are tracked
  by root rather than inferred from preceding MFA CI.
- No external deployment, live records, human notification, clinical/legal acceptance,
  shared-hosting approval, sustained capacity promise or production RTO is claimed.

Final staged source scan:212 targets/50 rules,0 findings/errors. Configured Trivy high/critical vulnerabilities, misconfigurations and secrets:0; npm audit:0. Built release API/browser/persistent-domain verification passed.

Recovery tooling20/20, negative install preflight, server typecheck passed. Packaged preflight16/16 machine checks passed, runtimeVerified:true and ready:false for explicit external decisions; authenticated current archive restore passed.

Final combined observability drill passed: deterministic promtool fixtures, real trace/
metric receipt, marker absence, discarded DB diagnostics, stopped API and collector,
and running-API/database outage all produced fresh firing/resolved receiver receipts.
Human notification remained false. All generated targets were cleaned; genuine old
artifacts and original source volumes/accounts were preserved. Local implementation
handoff is complete; root owns passive runtime scan, final commit and delivery CI.
Frontmatter remains in-progress until that delivery evidence is attached.
