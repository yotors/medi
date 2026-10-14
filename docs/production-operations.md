# Production operations rehearsal

This is synthetic engineering evidence, not hospital acceptance, a sustained
capacity commitment or permission to handle real patient records.

## Telemetry contract

Manual OpenTelemetry uses pinned API1.9.0, trace/resources/metrics2.12.0 and
OTLP HTTP0.223.0. Providers are local objects; no auto instrumentation, host/process
resource detectors, incoming propagation or baggage. Resource fields are the fixed
service name and release version. Exporter configuration is captured without OTEL
variables, including environment-supplied headers and endpoints. The destination
is fixed to the private collector. SDK diagnostic logging is disabled.

Request traces and structured completion logs contain a server-generated UUID,
registered route template (UNKNOWN for unmatched paths), fixed method/status/error
classes and elapsed milliseconds. Metrics omit correlation. Counters, duration,
inflight, pool state, exporter failures/drops and heartbeat contain no user,
hospital, session, URL, query, body, headers, SQL or exception content. Completion
is end-once, including connection aborts. Queues are bounded at256 spans, batches64,
HTTP export timeout1second and SDK export deadline1.5seconds; shutdown waits at most2.5seconds. Logging drops records when
stdout applies backpressure. Telemetry failure never denies a committed request.

The private collector limits memory64MiB and batches128. Trace files rotate at5MiB
with two backups and a one-day age limit. Prometheus retains at most24hours/128MB
on bounded temporary storage. Docker application logs rotate at10MiB with three
files. Gateway request logs are discarded. PostgreSQL container logging is disabled;
statement, parameter and verbose diagnostics are also suppressed, and its internal
logging collector is off. Health probes replace routine raw database diagnostics.
Old retained images/configurations have their historic limitations; current recovery
Compose applies the hardened database policy without modifying the archive.

Collector, Prometheus, Alertmanager and synthetic receiver publish no host ports.
These local HTTP destinations rely on the private container network. A real operator
must select independent protected storage, access controls, time synchronization,
retention and transport protection for the actual host. Do not expose these services.
The receiver stores only bounded counts for fixed alert names/statuses. A firing and
resolved receipt proves local wiring; it does not notify a human.

## Identity evidence

Verified password acceptance is distinct from full authentication. Restricted
sign-in records password.accepted; synthetic complete sign-in records
authentication.completed; factor verification/recovery retain their existing
transactional events. Logout commits its event and session-family deletion together.
Audit insertion failure rolls back the identity change and suppresses cookie success.
Runtime history is INSERT/SELECT-only. Operators retain responsibility for immutable
history archiving and retention; no deletion job silently removes it.

Rejected authentication/MFA/general requests share the existing fixed rejection
aggregate table. Nine operations, three outcomes and24 rotating hourly slots cap
storage at648 rows. Counts saturate at1,000,000. Old buckets expire after24hours.
Unknown targets are never attributed as actors, and no submitted identifiers enter
these buckets. These aggregates are not individual immutable audit events.

## Migration and replacement

The compiled schema manifest pins every SQL filename/version/checksum. History must
be contiguous from1 with no duplicates, gaps or future versions. Legacy adoption
reconstructs pinned historical SQL in a transient owner schema and compares its
relational structure before recording hashes. Runtime startup/readiness/protected
entry require the complete checksum inventory. Compatibility probes coalesce/cache
for two seconds; MFA envelope readiness retains its existing bound.

Migration and explicit runtime grants now share one transaction. The restricted
API never runs migrations. Stop application writers before owner schema changes;
the two-second compatibility cache is not a rolling-upgrade protocol. Never downgrade
an application against an untested newer schema.

`npm run release:upgrade-check -- .local/recovery.key .local/release-backups/pre-mfa-final.medi`
authenticates the genuine old archive, checks its exact baseline/images in a fresh
private target, proves failed migration rollback, compares historical columns/digests
and expected session invalidation, then exercises new MFA and an idempotent write.
It separately restores the original archive/image and verifies old sign-in as a
replacement rollback. Targets are removed before success; original archive/key/images
and source volumes remain retained. Replacement recovery loses changes after the
backup recovery point. A live maintenance/cutover decision remains an operator gate.

## Capacity and installation

`npm run release:capacity-check -- KEY ARCHIVE` targets only a generated isolated
current-version recovery installation. The declared contract is two hospitals,
1,000 patients and250 encounters each, five distinct role identities per hospital,
10-second ramp,180-second steady state,1-second think time and10-second HTTP timeout.
The provisioning admin is setup-only. Sessions complete real MFA challenge/enrollment;
no complete session is injected. Non-login p95<1500ms, unexpected failures<1% and zero
invariant violations are predeclared engineering hypotheses. Report failures without
loosening thresholds. Results distinguish fixed route classes, rejected requests,
transport failures and retries; no bodies, credentials or identifiers are evidence.

Versioned templates are in deploy/install-v1. Hosted dedicated installations and
hospital-local servers both use browser clients, HTTPS gateway and private API/DB.
Shared hosting and offline synchronization remain unapproved. Inputs require immutable
published images tied to Git/schema/config; private key/archive files stay outside
the bundle. `npm run install:preflight -- PRIVATE_INPUT` reports fixed missing check
names and external decisions. Evidence flags in this input are attestations and must
be supported by the implemented release/restore/monitoring checks; they do not run a
remote infrastructure scan or certify a chosen host. Static validation always reports ready:false. `npm run release:preflight -- KEY ARCHIVE` separately derives running image identity, private service boundaries, runtime schema/grants/MFA readiness, logging policy, collector freshness and an authenticated replacement restore from the owned local installation; it still reports ready:false pending external decisions.

Use `npm run release:mfa` for packaged operator bootstrap/recovery, with independently
verified operator identity and private grant output. Never run generic development
setup commands against an assumed packaged target. Preserve MFA keys and separately
held backup keys. Support access must be named, time-limited, approved and audited.
Routine restart preserves volumes; no automatic upgrade, destructive volume removal
or uncertain database downgrade is permitted. Verify release, alerts and replacement
restore before operator-controlled traffic cutover.

Founder decisions remain: hospital counterpart and workflow acceptance, hosted versus
local equipment/host, domain/TLS, approved data location/legal review, named operator,
support/incident ownership, human alert escalation, independent backup/key custody,
retention and measured operational recovery commitments. No cloud account is needed
to complete the local engineering rehearsal.

## Local verification record, 2026-10-14

The actual collector/alert drill passed trace and metric receipt, sensitive marker
absence, discarded database diagnostics, API-stop and collector-stop firing and
resolved receiver receipts. A separate running-API/database-outage drill passed
firing and resolved receipts after correcting the probe's Prometheus Content-Type.
Initial failures are retained as engineering findings: Docker copying a tmpfs saw
its underlying directory (trace storage now uses a private rotated volume), and
Prometheus rejected the probe response without its explicit metrics Content-Type.
No human notification or production SLO is inferred.

Focused registration regression passed24 tests; the additional transactional
login/logout audit-failure case passed. Telemetry privacy/end-once/failure/shutdown/
overflow checks, deterministic promtool fixtures and historical migration
adoption/rollback/replay/refusal checks passed. A genuine archive exposed pg_dump's
CHECK-expression AND flattening; the comparator now derives permitted alternate
forms from pinned SQL rather than discarding parentheses or trusting altered SQL.


The genuine schema1–11 archive upgrade and independent old replacement passed in87
seconds. Old API image: `sha256:c0a1c90c66ec27d53b7afa6af26c87f307f003f7f3f35544a79a08ee7058136b`;
verified new API image: `sha256:15bd68b231b011b47050e4729e20ca9ed218b0c6b4f0ef22bd1db5219b66a842`.
All33 historical table projections matched, staff credentials/roles remained intact,
and only expected session invalidation was excluded. Injected migration failure
rolled back. An extra legacy billing-receipt UPDATE privilege was refused before
migration; pinned schema11 session privileges deliberately exclude UPDATE.

The single full server regression ran186 tests:178 passed and8 failed because
historical fixtures expected the old migration/event contract. The inventory fixture
removed an applied marker and thereby triggered the new intentional gap refusal,
causing four subsequent failures; it now applies the historical integrity SQL without
forging migration history. The outpatient expectation now includes15. Two MFA
operator assertions now retain the legitimate password.accepted event while still
requiring no operator mutation. Focused migration2/2 and MFA2/2 reruns passed.

The first capacity attempt overlapped server tests and failed its immediate
post-overload recovery assertion; that early harness did not retain steady aggregates,
so it provides no passing capacity evidence. A focused isolated probe confirmed
acceptable overload statuses and identified the immediate recovery phase. Schema
readiness retains a failed probe for two seconds after pool saturation. Recovery now
uses at most six safe-read probes with500ms pauses and2s request deadlines, reports
all statuses and elapsed time, and preserves the original steady-state thresholds.
Failure artifacts now retain route aggregates even if a later drill fails.


The uncontended final capacity run passed its unchanged contract:1,818 measured
operations, all successful; zero unexpected failures, conflicts, retries or invariant
violations. Route p95 ranged60–101ms; p99 max162ms. Provisioning took67.221s. Actual
runtime was Node24.21.0/PostgreSQL16.14 on Arch Linux,12 CPUs/33,272,524,800 bytes host
RAM, with no per-API CPU/memory cgroup cap. Maximum sampled API RSS356,036,608 bytes;
pool waiting max14 includes the deliberate overload phase (41 metric samples).
Twelve synthetic bad logins returned ten401 and two429;24 overload requests produced
20 temporary-unavailable responses and recovery succeeded in31ms. The private target
was removed before success. Exact images, schema and per-route percentiles are in
[the sanitized aggregate artifact](operations-capacity-2026-10-14.json).


The affected inventory file passed18/18 after fixture correction. Final packaged
verification passed API/restricted grants, persistent clinical/billing/inventory/report
reconciliation and built browser MFA/sign-in/refresh/sign-out. Parent's final staged
Semgrep scanned212 targets with50 rules, zero findings/errors; configured Trivy
high/critical vulnerability, misconfiguration and secret findings were all zero;
npm audit reported zero. These are scoped automated checks, not independent
penetration testing or approval of a live installation.


Recovery tooling passed20/20, static preflight negative tests passed, and final server
typecheck passed. Packaged machine preflight returned runtimeVerified:true with all
16 checks true, including restored archive/image evidence and fresh collector data.
It deliberately returned ready:false for host/domain/TLS, dedicated topology,
operator/support, clinical/legal acceptance, human escalation, independent backup/key
custody and disk/retention decisions. No attestation flag substitutes for those checks.


Final combined observability verification passed deterministic promtool fixtures and
actual trace/metric receipt, marker absence, database diagnostic discard, stopped API,
stopped collector, and running API with failed database health. Every outage produced
fresh firing and resolved synthetic receiver receipts. Source services recovered and
all generated targets were cleaned. Delivery CI and passive runtime scan are recorded
separately by the delivery owner; no local check implies human alert delivery.


Final passive web baseline reached the owned HTTPS gateway:61 rules passed, no
FAIL-class findings, six warning groups (exit2). This unauthenticated scan does not
cover protected workflows or constitute a penetration test. Warnings are triaged
in [security evidence](security-evidence.md). The scanner now uses IPv4 for
localhost; the rehearsal gateway uses Caddy's documented
[default SNI](https://caddyserver.com/docs/caddyfile/options#default-sni) to serve its
localhost certificate to clients omitting SNI. The rebuilt gateway passed the
packaged API/browser verifier again. Capacity evidence retains the image identities
actually measured before this gateway-only TLS compatibility change.

The development database was migrated without account resets. The founder admin
login, session and logout were verified through http://127.0.0.1:5173/staff.


Delivery commit65bb78c passed all configured GitHub jobs: source-security, tooling
and local-release ([exact run](https://github.com/yotors/medi/actions/runs/38584302746)).
The previously corrected fixtures passed in the full regression. CI also passed
the genuine old fixture, restart/recovery, alert, upgrade/replacement, capacity and
preflight rehearsals. The final evidence-only documentation commit skips another
run of unchanged application code. This completes the scoped engineering work,
without changing the explicit external launch gates or missing product modules.

## Archive compatibility after tenant RLS

New local release archives use authenticated format4. The schema inventory now
records public policies (roles, command, permissive/restrictive mode, USING and
WITH CHECK expressions), table RLS/forced-RLS flags and view reloptions, including
`security_invoker`. Replacement recovery compares that complete inventory and
retains mandatory MFA key provisioning. Unsupported objects and policies outside
public remain refused; enabling RLS is no longer incorrectly treated as an
unsupported database object.

Original authenticated release formats1/2 retain their original inventory
projection and exact record-hash comparison. They are never rewritten. Recovery
refuses policies or nonempty view options that these old archives could not have
recorded. Dedicated production format3 remains separate: new archives record view
options, while original format3 archives retain the view projection they actually
authenticated. Policy metadata, table RLS flags and recorded view options are
compared on production replacement checks too.

Focused compatibility verification passed25 existing/new tests plus3 new fake
recovery integration cases: format4 successful comparison/MFA provisioning, changed
policy refusal and changed security-invoker option refusal, all with owned target
cleanup and source archive preservation. This is static/fake-process evidence;
root's real Docker recovery drill supplies runtime evidence. Original private
archives, keys, images and database contents were untouched.
