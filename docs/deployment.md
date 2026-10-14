# Database and deployment plan

Updated: 2026-10-14. This records the current development environment and the
decisions needed before deployment. It does not describe an existing production
installation.

## What is set up now

Medi is a responsive browser application. Locally, Vite serves the UI at
`http://127.0.0.1:5173/staff` and proxies `/api` to Fastify on loopback port 3100.
The API connects to PostgreSQL 16 in the dedicated Docker Compose project
`hospital-product-studio`, on loopback port 15432. The browser has no database
credentials and does not connect directly to PostgreSQL.

The named volume `hospital-product-studio_hospital-dev-data` persists database
files across ordinary container restarts. Ignored `.env` and `.local/` files hold
local credentials and backup artifacts. Migrations 001–011 create the staff, patient, outpatient, configuration, billing,
clinical correction, pharmacy inventory and report-access audit data model. Hospital isolation is enforced by the
application and relational constraints; the release rehearsal separates schema migration privileges from restricted
runtime grants. Per-hospital database row policies remain unimplemented.

On 2026-10-13, `docker compose ps` reported the database healthy and
`GET http://127.0.0.1:5173/api/health` returned `{"status":"ok"}`. The completed
[application CI run](https://github.com/yotors/medi/actions/runs/38390211322)
includes server/browser tests and a disposable-database restore check. This
evidence applies to the development implementation, not a production deployment.

The [pilot acceptance workbook](hospital-pilot-acceptance.md) records concrete
walkthroughs, installation choices and evidence owners before a live pilot.
The [security evidence index](security-evidence.md) maps selected ASVS requirements
to implementation evidence and unresolved gaps; the full assessment is open.

No database account, cloud subscription or hosting purchase is needed from the
founder now. Continue using synthetic records while building the product.

## PostgreSQL and the Supabase option

Keep the existing PostgreSQL Docker environment for current work. The user's
offer to use local Supabase is an available option, not a requirement to replace
a working database. Supabase supports both a local CLI/Docker environment and a
self-hosted Docker stack; the latter includes services beyond PostgreSQL. See
the official [local development guide](https://supabase.com/docs/guides/local-development)
and [self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker),
checked 2026-10-13.

Revisit this choice if requirements justify adopting its Auth, Storage or other
services. That would require an explicit architecture/migration decision:
current authentication belongs to the Medi API, and its migration runner allows
only dedicated database names and refuses unrelated existing schemas. Pointing
`DATABASE_URL` at a Supabase project alone is not a supported migration. Review
identity mapping, row access, service credentials, file authorization and backup
coverage before adopting any new service. No Supabase/cloud project has been
created, and no database replacement has been performed.

## When the founder needs to act

| Trigger | What will be prepared first | Founder input needed then |
| --- | --- | --- |
| Current local development | Working app, migrations, synthetic fixtures, tests and local restore checks | None for infrastructure |
| Ready to share a private staging demonstration | Deployable release artifact, configuration list, hosting options/cost estimate, HTTPS and access plan, test/rollback procedure | Hosting budget/account and desired URL or domain, after reviewing the concrete plan |
| Selecting the first hospital pilot | Department coverage, connectivity/power questionnaire, data-flow inventory, rollout/recovery plan and acceptance scenarios | Pilot counterpart, hosted versus hospital-local choice, responsible operators, approved data location and service commitments |
| Before the first real patient record | Validated workflows, security evidence, backup/restore and incident drills, training and migration rehearsal | Hospital acceptance and appropriate clinical/legal/operational review; production credentials supplied through a private secret mechanism |
| Adding an external integration | A specific integration contract, data fields, failure behavior and synthetic test plan | Relevant provider account/access, agreements and costs only when the integration is in scope |

The agent should raise these decisions when their trigger is reached, before
spending money, exposing a service or moving patient data. Do not ask the founder
to buy hosting merely to continue local feature development. Do not request
secrets in chat or commit them to the public repository.

## Deployment work still required

`compose.yaml` runs the development database. The separate `compose.release.yaml`
now packages the compiled application, HTTPS gateway and PostgreSQL, using its own
project and volumes. It is a **local synthetic release rehearsal**. It does not
select cloud hosting, establish a hospital installation or configure live backups.

The API runs as an unprivileged container user with a read-only filesystem and a
restricted database role. A separate migration job owns schema changes. Runtime
grants cannot change schema, migration records or existing audit entries. Hospital
boundaries are still application-enforced, not PostgreSQL row-level policies.
Only HTTPS port 8443 binds host loopback; neither API nor database publishes a
host port. Database health and successful migrations gate API startup. The proxy
trusts one internal hop; this setting is safe only with that network boundary.

The rehearsal intentionally discards gateway logs to avoid sensitive request
headers in diagnostics. Production requires useful redacted monitoring, alerting
and retention before rollout. The development fixtures and their local CA must
never become production credentials or production certificate infrastructure.

Before a live pilot, complete scoped authentication/authorization review,
redacted monitoring and tested alerts, encrypted offsite backup/restore,
retention/access controls, incident ownership and measured recovery objectives.
Development backup commands remain limited to their dedicated local database.
The encrypted packaged-release recovery tooling below is a separate rehearsal;
neither constitutes an operated production backup service. See
[release evidence](readiness.md).

The earlier [deployment comparison](../_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/addendum.md)
compares hosted, hospital-local and hybrid operation. Its legal observations need
current local specialist confirmation before selecting a live-data location.
Deployment and hospital tenancy are separate decisions: either operating model
still needs explicit customer boundaries and controlled vendor support.

## Local operations

Run these from the repository root:

```sh
npm run db:local          # Create config only if absent; start/wait for local DB
npm run db:migrate        # Apply pending migrations to the dedicated database
npm run dev:api           # API; keep running
# In another terminal:
npm run dev              # Browser app; keep running
```

Existing installations retain their accounts. For a new checkout, follow
[staff provisioning](staff-workspace.md#run-locally); passwords are not in Git.

```sh
npm run db:backup         # Private local logical backup
npm run db:restore-check  # New backup, restore to disposable DB, compare schema/data
docker compose stop      # Stop the database while preserving its named volume
```

Do not remove the named volume to restart the app. Local restoration tests do
not replace an independently stored production backup or a downtime procedure.

## Built release rehearsal

Prerequisites: Docker Engine with Compose, the repository's supported Node version,
`npm ci --ignore-scripts`, and Playwright Chromium (`PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright
npx --no-install playwright install chromium`). From the repository root:

```sh
npm run release:local     # Build, migrate and start an isolated installation
npm run release:verify    # Create/reuse a synthetic admin; verify HTTPS/API/browser
npm run release:status
npm run release:stop      # Preserve configuration, certificates and database
npm run release:local
npm run release:verify    # Check previous records, histories and retry receipts
```

Open `https://localhost:8443/staff`. Caddy issues a certificate from its private
local CA; no host trust store is changed. Verification checks that CA directly and
uses a disposable browser context. For manual browsing, explicitly accept/trust
the local rehearsal certificate only. Public staging must use a real hostname
and certificate configuration, after its access plan is approved.

The runner generates `.local/release.env` with private permissions and never
prints its credentials. The verifier provisions only a synthetic hospital and
administrator, storing login fields in `.local/release-verification.json` (mode
600). Read that file privately to sign in; do not paste it into chat, CI artifacts
or issues. Existing accounts are never overwritten. Hospital administrators can
then provision staff through the UI. A production bootstrap/recovery ceremony
with accountable operators remains a release gate.

Verification replaces its private fixture file atomically after syncing the new
contents. Each subsequent run compares saved row digests for the prior patient's
visit and note, staff account/history, department and service versions, audit
events, clinical corrections/reviews, pharmacy stock/dispensing, and idempotency
receipts before creating new fixtures. These checks use
the restricted runtime account. The gateway has its own HTTPS readiness probe;
the verifier separately validates the local CA and built page contents.

The Docker project is `medi-release-local`; volumes are
`medi-release-local_release-database`, `medi-release-local_release-certificates`
and `medi-release-local_release-web-config`. They are separate from development.
Do not delete them for a restart, regenerate the credential file against an
existing database, or use `down -v` to upgrade. If the private configuration is
lost, restore it from its protected backup before restarting.

The runtime images contain compiled code/static assets and production packages.
Build context exclusions prevent `.env`, `.local`, keys, agent tooling and
workstation dependencies from entering the build; test source is used for the
build's type checks but is absent from runtime images. Base image digests are
pinned and need a deliberate security-update process.

## Upgrade and rollback procedure

For a rehearsal update, preserve `.local/release.env`, record the current Git
revision and image IDs, and verify a restorable backup before upgrading any
valuable dataset. `npm run release:local` rebuilds code, applies additive pending
migrations through the schema-owner job, then recreates healthy services. Run
`npm run release:verify` after every update. Verification briefly stops and
restarts only the rehearsal database to check readiness and recovery; run it
while no one is using this synthetic installation. Do not run the development backup
helper against this separate release database: it intentionally refuses other
databases.

Reverting application code does **not** revert a migrated database. Roll back
application images only when compatibility with the new schema has been tested;
otherwise restore a verified full database/configuration backup into an isolated
replacement and verify it before switching traffic. Never erase a failed database
as a recovery shortcut. Encrypted release backup and isolated restoration are exercised by the tooling
below. Immutable published artifacts, upgrade compatibility rehearsal and an
operator-run rollback drill remain necessary before live patient records.

Implementation references: [Compose startup dependencies](https://docs.docker.com/compose/how-tos/startup-order/),
[Caddy local HTTPS](https://caddyserver.com/docs/automatic-https),
[Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/), and
[PostgreSQL privileges](https://www.postgresql.org/docs/16/sql-grant.html).

Build note: npm treats platform compiler packages as optional. The image build
checks TypeScript and Vite immediately after the locked installation, so an
incomplete download fails its install layer instead of being cached as usable.
See [npm dependency semantics](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
and [locked installation behavior](https://docs.npmjs.com/cli/v11/commands/npm-ci/).


## Encrypted packaged-release recovery

The recovery tools target only the owned `medi-release-local` rehearsal. They do
not expand the development database helper's scope and do not restore over a
running source installation. Verification status is tracked in the
[recovery specification](../_bmad-output/implementation-artifacts/spec-encrypted-release-recovery.md).

Create a private archive directory and a separate key file once:

```sh
install -d -m 700 .local/release-backups
npm run release:key-init -- .local/recovery.key
```

Key initialization refuses an existing file. Retain that original key; generating
a different key does not recover an older archive. The local example is a
rehearsal, not independent key custody. Before live use, an operator must choose
protected independent storage and test access to both the archives and their
matching key. Do not put the key into an archive, Git, a support ticket or chat.

Back up the healthy local release to a new filename, then check recovery:

```sh
npm run release:backup -- .local/recovery.key .local/release-backups/manual-001.medi
npm run release:recover-check -- .local/recovery.key .local/release-backups/manual-001.medi
```

The archive encrypts a consistent PostgreSQL snapshot and its schema/data/grant
inventory, private release configuration, available synthetic verification fixture,
and exact running image identities. The backup uses a PostgreSQL exported
snapshot shared with `pg_dump`; the inventory does not compare the dump to a
later state. Archive encryption uses AES-256-GCM with a fresh nonce and
an authenticated format header. Recovery verifies the whole authentication tag
before using metadata or starting database restoration. See the official
[PostgreSQL snapshot documentation](https://www.postgresql.org/docs/16/functions-admin.html)
and [pg_dump snapshot option](https://www.postgresql.org/docs/16/app-pgdump.html).

Recovery uses a generated isolated Compose project with fresh volumes and no
published ports. It requires the recorded images to be available locally and
checks the restored baseline before sign-in can create session rows. It removes
only its generated target resources afterwards. The source project need not be
running. A successful check is a recovery rehearsal; it does not route hospital
traffic to a replacement or alter the original database.

Key, archive and scratch paths must be private real paths without symlink
components: directories mode 700, files mode 600. The initial format limits an
archive to 1 GiB and its encrypted manifest to 4 MiB. Streaming operations and
snapshot holding are bounded to 240 seconds; other Docker operations are bounded
to 180 seconds. These are guardrails for this rehearsal, not measured limits for
a hospital. Larger datasets need a reviewed backup design and an appropriate
recovery test. Failures must leave no accepted partial archive; diagnostics must
not expose database content, configuration or credentials.

The stronger synthetic drill creates a new archive while exercising concurrent
source activity, then checks isolated recovery with the source stopped and
restores source availability:

```sh
npm run release:recovery-drill -- .local/recovery.key .local/release-backups/drill-001.medi
```

Run the drill only when no one is using the synthetic release. Preserve the
successful archive and referenced images for subsequent upgrade verification.
Do not prune those images or replace the key. Moving recovery to another host
also requires supplying the recorded image artifacts; the encrypted database
archive is not a container-image export.

Offsite transfer, scheduled execution, retention/deletion policy, key custody,
backup failure alerts, recovery objectives, operator acceptance and any
point-in-time recovery remain installation decisions. No tested local duration
establishes a production recovery SLA.
