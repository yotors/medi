# Product decisions and release evidence

Status as of 2026-10-13: the first server-backed outpatient milestone is
implemented and verified locally and in
[GitHub Actions](https://github.com/yotors/medi/actions/runs/38390211322).
The commercial hospital product is unfinished. See the
[capability gaps and delivery milestones](product-roadmap.md) and
[database/deployment plan](deployment.md). Research and 24 candidate requirements
are recorded. The user selected a calm, light/teal interface and authorized
continued product development; clinical scope and production deployment still
need validation. Outpatient completion does not establish readiness for live care.
The [whole-product PRD](../_bmad-output/planning-artifacts/prd/prd-medi-2026-10-13/prd.md)
is a partial draft; its proposed capabilities and release gates are not yet an
approved hospital package.

The staff workspace now persists registration and the outpatient journey with
server sessions, hospital-scoped access, role-projected records and transactional
commands. See its [implementation and limits](staff-workspace.md). The original
`/` walkthrough remains a separate browser-only demonstration.

See [prototype boundaries](prototype-boundaries.md) for the separation between
local demonstration and production requirements.

See the [product brief](../_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/brief.md)
and [discovery addendum](../_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/addendum.md).

## Discovery

- [x] Initial market: Ethiopia; small private hospitals and medical centers.
- [ ] Product name, validated user problems, and differentiation.
- [x] Initial synthetic outpatient journey and implementation acceptance criteria; hospital validation remains open.
- [ ] First commercial release's full department coverage and agreed hospital acceptance criteria.
- [ ] Scope boundaries, budget, timeline, geography, and data requirements.
- [ ] Production architecture, deployment and external integrations; local staff slice uses Fastify/PostgreSQL.
- [x] Prototype uses Radix Dialog and user-selected calm light/teal design; [design](../DESIGN.md).

## Product verification

Every completed item must link to implementation and dated verification evidence.
An installed tool or a green fixture test does not complete these items.

| Area | Evidence required | Status |
| --- | --- | --- |
| Core journeys | Acceptance tests including error/retry paths | Server-backed outpatient, multi-role, retry and draft-recovery journeys pass; complete departmental workflows and hospital acceptance pending ([evidence](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md)) |
| Authorization | Cross-user/tenant tests and administrator endpoint checks | Seven preliminary staff roles, response projections and hospital isolation tested; hospital validation pending ([evidence](staff-workspace.md)) |
| Data integrity | Relevant race, replay, idempotency and transaction tests | Registration and visit transaction/replay/rollback checks pass; production migration and financial-ledger work remain ([evidence](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md)) |
| Security requirements | Applicable OWASP ASVS 5.0 Level 2 requirements mapped to code/tests; justify exclusions | Initial registration control mapping recorded; complete ASVS/risk assessment pending ([mapping](staff-workspace.md)) |
| Accessibility | Automated checks plus keyboard and assistive-technology review | Staff desktop/mobile journey, axe and keyboard checks pass; assistive-technology review pending ([evidence](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md)) |
| Visual quality | Desktop/mobile screenshots and loading/empty/error states | Staff outpatient visual review passed within its captured scope; broader states documented in the [implementation evidence](../_bmad-output/implementation-artifacts/spec-connected-outpatient.md) |
| Dependencies and source | Semgrep, Trivy and package audit reports with triaged findings | Configured source/dependency gates passed for outpatient revision ad914e7; see [CI](https://github.com/yotors/medi/actions/runs/38390211322) |
| Running application security | Authenticated ZAP configuration and business-logic tests | Pending staging |
| Capacity | Agreed traffic mix, dataset, concurrency, duration, latency/error thresholds, environment and cost | Pending workload |
| Observability | Redacted OpenTelemetry traces/metrics/logs, backend and tested alerts | Pending services |
| Operations | Backup restoration, migrations, rollback, secrets handling, incident owner | Local isolated restore matches schema and all table counts/content digests; production recovery pending |
| CI enforcement | Application checks running on PRs and required branch checks configured | GitHub Actions connected to yotors/medi; branch protection pending |

Do not assert vulnerability-free operation, compliance, or support for a user count
without relevant evidence. Report measured results and remaining uncertainty.
