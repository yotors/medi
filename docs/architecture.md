# Architecture

One browser app calls a same-origin HTTPS gateway. The gateway serves built
assets and forwards `/api` to the private API; PostgreSQL and monitoring publish
no host ports. Dedicated installations can be hosted or hospital-local.

`shared` owns strict schemas, DTOs, role maps and domain/financial/time rules.
`server/app.ts` installs authentication/CSRF/Origin/compatibility hooks and registers
workflow modules. Mutations use bounded transactions, hospital locks, renewed
current authority, expected revisions and durable retry receipts; linked records
and audits commit together. Clinical/departmental JSON payloads are strictly
validated, with composite hospital FKs and immutable event histories.

Registration facts remain unchanged. The invoker `patient_directory` view shows
current audited demographic profiles. Identity links preserve original MRNs and
history. Financial/stock ledgers retain exact minor units and quantities.

Every protected operation scopes the authenticated hospital/current role.
`currentActor` sets transaction-local tenant context; clinical/financial/stock/
governance row policies and the invoker view deny unset/foreign runtime context.
The runtime is not a table owner and cannot bypass RLS. Narrow identity bootstrap
queries and bounded rejection aggregates remain separately protected.
Support accounts require MFA and an approved expiring window, with auditor-only
permissions enforced by API/database.

API and owner credentials use different private volumes. The API runs nonroot,
read-only. Owner migrations/grants are deliberate maintenance operations; reviewed
SQL byte hashes are immutable. Telemetry has bounded allowlists and private
retention. Encrypted consistent backups authenticate before isolated replacement;
replacement returns to the backup recovery point and preserves the source.

See [deployment](deployment.md), [security evidence](security-evidence.md) and
[operations](production-operations.md) for actual verification and limitations.
