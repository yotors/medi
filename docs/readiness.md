# Product decisions and release evidence

Status: first synthetic-data outpatient prototype authorized on 2026-10-13 and
implemented and locally verified; see [verification evidence](prototype-verification.md). Research and 24 candidate requirements are recorded. The user
selected a calm, light/teal interface. Production scope and deployment remain
unapproved; prototype completion does not establish readiness for live care.

The subsequent staff registration slice has server sessions, hospital-scoped
access and PostgreSQL persistence. Its [implementation and limits](staff-workspace.md)
apply only to registration/search; the clinical walkthrough remains browser-only.

See [prototype boundaries](prototype-boundaries.md) for the separation between
local demonstration and production requirements.

See the [product brief](../_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/brief.md)
and [discovery addendum](../_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/addendum.md).

## Discovery

- [x] Initial market: Ethiopia; small private hospitals and medical centers.
- [ ] Product name, validated user problems, and differentiation.
- [ ] Main user journey and measurable MVP acceptance criteria.
- [ ] Scope boundaries, budget, timeline, geography, and data requirements.
- [ ] Production architecture, deployment and external integrations; local staff slice uses Fastify/PostgreSQL.
- [x] Prototype uses Radix Dialog and user-selected calm light/teal design; [design](../DESIGN.md).

## Product verification

Every completed item must link to implementation and dated verification evidence.
An installed tool or a green fixture test does not complete these items.

| Area | Evidence required | Status |
| --- | --- | --- |
| Core journeys | Acceptance tests including error/retry paths | Prototype journey passes; production pending ([evidence](prototype-verification.md)) |
| Authorization | Cross-user/tenant tests and administrator endpoint checks | Registration receptionist/admin/auditor permissions and hospital isolation tested; clinical roles pending ([evidence](staff-workspace.md)) |
| Data integrity | Relevant race, replay, idempotency and transaction tests | Demo transitions, retry and stale-tab checks pass; staff registration transaction/replay/rollback checks pass; clinical transactions pending ([evidence](prototype-verification.md)) |
| Security requirements | Applicable OWASP ASVS 5.0 Level 2 requirements mapped to code/tests; justify exclusions | Initial registration control mapping recorded; complete ASVS/risk assessment pending ([mapping](staff-workspace.md)) |
| Accessibility | Automated checks plus keyboard and assistive-technology review | Prototype automated/visual evidence available; assistive-technology review pending ([evidence](prototype-verification.md)) |
| Visual quality | Desktop/mobile screenshots and loading/empty/error states | Prototype automated/visual evidence available; assistive-technology review pending ([evidence](prototype-verification.md)) |
| Dependencies and source | Semgrep, Trivy and package audit reports with triaged findings | Local prototype scans complete; see [scope and results](prototype-verification.md) |
| Running application security | Authenticated ZAP configuration and business-logic tests | Pending staging |
| Capacity | Agreed traffic mix, dataset, concurrency, duration, latency/error thresholds, environment and cost | Pending workload |
| Observability | Redacted OpenTelemetry traces/metrics/logs, backend and tested alerts | Pending services |
| Operations | Backup restoration, migrations, rollback, secrets handling, incident owner | Pending deployment |
| CI enforcement | Application checks running on PRs and required branch checks configured | Pending GitHub remote |

Do not assert vulnerability-free operation, compliance, or support for a user count
without relevant evidence. Report measured results and remaining uncertainty.
