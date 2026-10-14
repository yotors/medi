# Security evidence and open assessment

Reviewed 2026-10-14 against selected OWASP ASVS **5.0.0** requirements at levels
1 and 2. This is a scoped evidence index, not a completed ASVS assessment or
certification. Unlisted requirements remain unassessed. Evidence refers to the
synthetic local application; production infrastructure needs separate review.

## Authorization

Requirement references: [ASVS V8, pinned version](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x17-V8-Authorization.md).

| Requirement | Current evidence | Remaining assessment |
| --- | --- | --- |
| 8.1.1, 8.1.2: function/data/field rules | `shared/outpatient.ts` role actions and sections; clinical spec and `server/clinical.ts` projections | Hospital approval of roles and minimum necessary patient-directory access |
| 8.2.1, 8.3.1: trusted permission enforcement | Server routes enforce roles independently of UI; API role-denial tests | Endpoint inventory and independent assessment |
| 8.2.2, 8.4.1: object and tenant boundaries | Hospital-scoped predicates and composite foreign keys; two-hospital API cases in registration/outpatient/administration/configuration/billing/clinical/inventory/reports suites | Review vendor support access and chosen tenancy model; database row policies are absent |
| 8.2.3: field permissions | Populated seven-role clinical projection test, including metadata-only auditor history | Review every patient, financial and report projection against approved policy |

Patient directory/detail, clinical, inventory and report tests also exercise authority changes while waiting
for a hospital lock; mutation suites cover denied replay after revocation. These
are useful additional evidence, not a claim that every endpoint has identical authority timing.

## Validation and transaction integrity

Requirement references: [ASVS V2, pinned version](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x11-V2-Validation-and-Business-Logic.md).

| Requirement | Current evidence | Remaining assessment |
| --- | --- | --- |
| 2.1.1–2.1.3: documented rules and limits | Shared Zod schemas and slice specifications define field/state/revision constraints | Consolidate approved business limits and hospital-specific workflows |
| 2.2.1–2.2.3: trusted input and consistency checks | Strict schemas in shared modules, server parsing, scoped target and state validation | Full input inventory including deployment and imported data |
| 2.3.1, 2.3.2: workflow sequencing | Domain transitions, correction review closure gate, payment balance/revision checks | Practitioner validation of care and financial workflow |
| 2.3.3, 2.3.4: atomicity and resource concurrency | Hospital locks, transactions, immutable receipts; race/retry/rollback API tests | Realistic contention and capacity measurements |
| 2.4.1: excessive-request controls | Login/reauthentication buckets, body limits, bounded result pages and selected transaction timeouts | General authenticated API quotas and abuse monitoring are incomplete |

## Data protection

Requirement references: [ASVS V14, pinned version](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x23-V14-Data-Protection.md).

| Requirement | Current evidence | Remaining assessment |
| --- | --- | --- |
| 14.1.1, 14.1.2, 14.2.4: protection policy | Synthetic-data restriction and pilot governance workbook | Data classification, retention, encryption/key ownership and approved data location are unresolved |
| 14.2.1: sensitive request placement | Credentials and patient-directory/visit-queue searches use authenticated JSON bodies; search POSTs require exact Origin and session CSRF; legacy GET q is rejected; API/browser transport cases | Review production proxy, monitoring and diagnostic redaction end to end |
| 14.2.2, 14.3.2: caching controls | API and release gateway send `Cache-Control: no-store` | Verify chosen production proxies/CDN and browser behavior |
| 14.3.1, 14.3.3: client cleanup/storage | Staff UI clears identity/drafts on expiry/logout; state remains in memory; browser expiry/logout cases | Independent browser storage and offline-sign-out assessment; `/` is a separate synthetic local-storage demo |

## Security logging and errors

Requirement references: [ASVS V16, pinned version](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md).

| Requirement | Current evidence | Remaining assessment |
| --- | --- | --- |
| 16.1.1, 16.2.1–16.2.5: inventory and metadata | Attributable domain histories and report-read events (actor, role, range, section/page metadata) in PostgreSQL; application request logging disabled; rehearsal gateway logs discarded | Stack-wide log inventory, retention, time synchronization and correlation |
| 16.3.1–16.3.4: security events | Domain audit is available; login counters support throttling | Durable authentication, authorization-denial, validation-abuse and unexpected-error events are incomplete; counters are not an event trail |
| 16.4.1–16.4.3: protected logging | Immutable database histories and restricted runtime grants tested in release verifier | Separate protected log destination, encoding review and secure transport; schema owner remains privileged |
| 16.5.1–16.5.3: secure failure | Generic API error handler, transactional rollback tests, private-read pool saturation/recovery and natural session-expiry tests, release database-outage recovery check | Wider dependency-failure and production recovery drills |

## How to use the evidence

Run the repository's type, API, browser, source/dependency and release checks for
the exact candidate commit. Record failures and exclusions alongside the result;
do not translate a green scanner into an ASVS pass. The clinical, inventory and
operational-report specifications record dated local evidence and review outcomes for their respective scopes.

The [pilot workbook](hospital-pilot-acceptance.md) assigns acceptance gates.
Before live data, a security reviewer must finish applicability decisions,
verify requirements against the chosen deployment and resolve material gaps.
Keep sensitive operational evidence outside this public repository.
